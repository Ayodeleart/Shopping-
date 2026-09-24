/* Paystack adapter. Written against Paystack's documented REST API (https://paystack.com/docs/api/):
 *   POST /transaction/initialize, GET /transaction/verify/:reference, POST /refund,
 *   POST /transferrecipient, POST /transfer, GET /transfer/verify/:reference, GET /bank,
 *   webhooks signed with HMAC SHA512 of the raw body (header x-paystack-signature).
 * It has not been run against live Paystack from this repository's tests: those use recorded response shapes.
 * Check each call against the current Paystack docs when you add your keys.
 *
 * Environment: PAYSTACK_SECRET_KEY (sk_test_... for test mode, sk_live_... for live)
 * Optional:    PAYSTACK_CHANNELS  comma list of channels to offer (default: card,bank_transfer,ussd,bank)
 */
const crypto = require('crypto');

const BASE = 'https://api.paystack.co';
const secret = () => process.env.PAYSTACK_SECRET_KEY || '';
const kobo = (n) => Math.round(Number(n) * 100);
const naira = (k) => Number(k || 0) / 100;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: 'Bearer ' + secret(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch (_) { /* non-JSON error page */ }
  if (!res.ok || json.status === false) {
    const err = new Error(json.message || 'Paystack request failed (' + res.status + ')');
    err.status = res.status; err.provider = json;
    throw err;
  }
  return json;
}

const LABELS = {
  card: ['Card', 'Debit or credit card'],
  bank_transfer: ['Bank transfer', 'Pay from your banking app'],
  ussd: ['USSD', 'Dial a code on your phone'],
  bank: ['Pay with bank', 'Sign in to your bank'],
  qr: ['QR code', 'Scan to pay'],
  mobile_money: ['Mobile money', 'Pay from your wallet'],
  eft: ['EFT', 'Electronic funds transfer'],
  apple_pay: ['Apple Pay', 'Pay with Apple Pay']
};

function channelToMethod(c) { return c || null; }

module.exports = {
  id: 'paystack',
  requiredEnv: ['PAYSTACK_SECRET_KEY'],
  get isTest() { return secret().startsWith('sk_test_'); },
  configured() { return !!secret(); },

  methods() {
    const list = (process.env.PAYSTACK_CHANNELS || 'card,bank_transfer,ussd,bank').split(',').map(s => s.trim()).filter(Boolean);
    return list.filter(id => LABELS[id]).map(id => ({ id, label: LABELS[id][0], hint: LABELS[id][1] }));
  },

  async initializePayment({ reference, amount, currency, email, method, callbackUrl, metadata }) {
    const body = { email, amount: kobo(amount), currency: currency || 'NGN', reference, callback_url: callbackUrl, metadata };
    if (method && method !== 'any' && LABELS[method]) body.channels = [method];
    const j = await call('POST', '/transaction/initialize', body);
    return { authorizationUrl: j.data.authorization_url, providerReference: j.data.reference, accessCode: j.data.access_code };
  },

  async verifyPayment(reference) {
    const j = await call('GET', '/transaction/verify/' + encodeURIComponent(reference));
    const d = j.data || {};
    const status = d.status === 'success' ? 'successful'
      : (d.status === 'failed' || d.status === 'reversed') ? 'failed' : 'pending';
    return {
      status, amount: naira(d.amount), currency: d.currency, method: channelToMethod(d.channel),
      providerTxnId: d.id != null ? String(d.id) : null, fee: naira(d.fees), paidAt: d.paid_at || null,
      // a small summary only: never store card details
      raw: { id: d.id, status: d.status, channel: d.channel, gateway_response: d.gateway_response, paid_at: d.paid_at, currency: d.currency, amount: d.amount, fees: d.fees }
    };
  },

  parseWebhook(rawBody, headers) {
    const sig = String(headers['x-paystack-signature'] || '');
    const expected = crypto.createHmac('sha512', secret()).update(rawBody).digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (!sig || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const e = new Error('Invalid webhook signature'); e.status = 401; e.code = 'invalid_signature'; throw e;
    }
    const body = JSON.parse(rawBody);
    const d = body.data || {};
    const key = d.id != null ? d.id : (d.reference || d.transfer_code || '');
    const eventId = `${body.event}:${key}`;
    const map = {
      'charge.success': 'payment.success',
      'refund.processed': 'refund.processed', 'refund.failed': 'refund.failed',
      'transfer.success': 'payout.success', 'transfer.failed': 'payout.failed', 'transfer.reversed': 'payout.reversed'
    };
    const type = map[body.event];
    if (!type) return { events: [{ eventId, type: 'ignored:' + body.event, reference: d.reference || null, raw: {} }] };
    return { events: [{
      eventId, type,
      reference: d.reference || d.transaction_reference || null,     // ours (payment or payout reference)
      transactionReference: d.transaction_reference || null,         // refunds point at the payment
      providerTxnId: d.id != null ? String(d.id) : null,
      providerRefundId: d.id != null ? String(d.id) : null,
      transferId: d.transfer_code || null,
      raw: { event: body.event, id: d.id, status: d.status }
    }] };
  },

  async refundPayment({ reference, providerTxnId, amount, reason }) {
    const j = await call('POST', '/refund', { transaction: providerTxnId || reference, amount: kobo(amount), merchant_note: reason || undefined });
    const s = (j.data && j.data.status) || 'pending';
    return { status: s === 'processed' ? 'processed' : (s === 'failed' ? 'failed' : 'pending'), providerRefundId: j.data && j.data.id != null ? String(j.data.id) : null };
  },

  async createPayout({ reference, amount, reason, recipient }) {
    let code = recipient.code;
    if (!code) {
      const r = await call('POST', '/transferrecipient', { type: 'nuban', name: recipient.name, account_number: recipient.accountNumber, bank_code: recipient.bankCode, currency: 'NGN' });
      code = r.data.recipient_code;
    }
    const t = await call('POST', '/transfer', { source: 'balance', amount: kobo(amount), recipient: code, reason: reason || 'Marcato seller payout', reference });
    const s = t.data.status;
    return { status: s === 'success' ? 'paid' : (s === 'failed' ? 'failed' : 'processing'), transferId: t.data.transfer_code || null, recipientCode: code, needsApproval: s === 'otp' };
  },

  async checkPayoutStatus(reference) {
    const j = await call('GET', '/transfer/verify/' + encodeURIComponent(reference));
    const s = j.data.status;
    return { status: s === 'success' ? 'paid' : (s === 'failed' ? 'failed' : (s === 'reversed' ? 'reversed' : 'processing')), transferId: j.data.transfer_code || null };
  },

  async listBanks() {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const j = await call('GET', `/bank?country=nigeria&perPage=100&page=${page}`);
      (j.data || []).forEach(b => out.push({ name: b.name, code: b.code }));
      if (!j.data || j.data.length < 100) break;
    }
    return out;
  }
};
