/* MOCK PROVIDER: development and automated tests only.
 *
 * It never contacts a bank or gateway and never moves money. Every payment made through it is stored with
 * is_test = true, so it can never be mistaken for, or mixed into, real balances and payouts.
 * It refuses to run on a production deployment.
 *
 * Enable locally with:  PAYMENT_PROVIDER=mock  ALLOW_MOCK_PAYMENTS=true  MOCK_WEBHOOK_SECRET=<any long random string>
 */
const crypto = require('crypto');
const { db } = require('../db');

const enabled = () => process.env.ALLOW_MOCK_PAYMENTS === 'true' && process.env.VERCEL_ENV !== 'production';
const secret = () => process.env.MOCK_WEBHOOK_SECRET || '';

function sign(raw) { return crypto.createHmac('sha256', secret()).update(raw).digest('hex'); }

module.exports = {
  id: 'mock',
  isTest: true,
  requiredEnv: ['ALLOW_MOCK_PAYMENTS', 'MOCK_WEBHOOK_SECRET'],
  configured() { return enabled() && !!secret(); },
  sign,

  methods() {
    return [
      { id: 'card', label: 'Card (test)', hint: 'Simulated, no real money' },
      { id: 'bank_transfer', label: 'Bank transfer (test)', hint: 'Simulated, no real money' },
      { id: 'ussd', label: 'USSD (test)', hint: 'Simulated, no real money' }
    ];
  },

  async initializePayment({ reference, callbackUrl }) {
    const base = callbackUrl.replace(/\/\?.*$/, '').replace(/\/+$/, '');
    return { authorizationUrl: `${base}/api/mock-pay?reference=${encodeURIComponent(reference)}`, providerReference: reference };
  },

  // The mock page records the outcome the developer picked on the payment row; verification reads it back.
  async verifyPayment(reference) {
    const { data } = await db().from('payments').select('amount, currency, raw, method').eq('reference', reference).maybeSingle();
    const outcome = data && data.raw && data.raw.mock && data.raw.mock.outcome;
    if (!data) return { status: 'pending' };
    return {
      status: outcome === 'success' ? 'successful' : outcome === 'fail' ? 'failed' : 'pending',
      amount: Number(data.amount), currency: data.currency, method: data.method || 'card',
      providerTxnId: outcome === 'success' ? 'mock_' + reference : null, fee: 0, raw: { mock: true, outcome }
    };
  },

  parseWebhook(rawBody, headers) {
    const sig = String(headers['x-mock-signature'] || '');
    const expected = sign(rawBody);
    if (!secret() || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      const e = new Error('Invalid webhook signature'); e.status = 401; e.code = 'invalid_signature'; throw e;
    }
    const b = JSON.parse(rawBody);
    return { events: [{ eventId: b.eventId, type: b.type, reference: b.reference, transactionReference: b.transactionReference || null,
      providerTxnId: b.providerTxnId || null, providerRefundId: b.providerRefundId || null, transferId: b.transferId || null, raw: { mock: true } }] };
  },

  async refundPayment({ refundReference }) { return { status: 'processed', providerRefundId: 'mock_rf_' + refundReference }; },
  async createPayout({ reference }) { return { status: 'paid', transferId: 'mock_tr_' + reference, recipientCode: 'mock_recipient' }; },
  async checkPayoutStatus() { return { status: 'paid', transferId: null }; },
  async listBanks() { return [{ name: 'Test Bank A', code: '001' }, { name: 'Test Bank B', code: '002' }]; }
};
