/* Provider-independent payment flows. Every money change is made by a SQL function (one transaction, idempotent);
 * this file decides WHAT to call, after checking with the provider. The browser is never trusted for payment results. */
const crypto = require('crypto');
const { db, rpc } = require('../db');
const { HttpError } = require('../http');
const providers = require('./index');

function newReference(prefix) {
  const p = prefix || 'MCT';
  return `${p}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
function newLowerRef(prefix) {          // transfer references are lowercase alphanumerics with dashes/underscores
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

async function paymentByReference(reference) {
  const { data, error } = await db().from('payments').select('*').eq('reference', reference).maybeSingle();
  if (error) throw error;
  return data;
}

// Ask the provider what really happened, then record it. Safe to call any number of times.
async function verifyAndFinalize(reference) {
  const pay = await paymentByReference(reference);
  if (!pay) throw new HttpError(404, 'Payment not found', 'payment_not_found');
  if (['successful', 'partially_refunded', 'refunded', 'disputed'].includes(pay.status)) {
    return { payment_status: pay.status, order_id: pay.order_id, already: true };
  }
  const provider = providers.get(pay.provider);
  if (!provider.configured()) throw new HttpError(503, 'Payment provider is not configured', 'payments_not_configured');
  const v = await provider.verifyPayment(reference);

  if (v.status === 'successful') {
    if (v.currency && v.currency !== pay.currency) {
      await rpc('fail_payment', { p_reference: reference, p_status: 'failed', p_reason: 'currency_mismatch' });
      return { payment_status: 'failed', order_id: pay.order_id };
    }
    const r = await rpc('finalize_payment', {
      p_reference: reference, p_provider_txn_id: v.providerTxnId || null, p_amount_paid: v.amount, p_method: v.method || null,
      p_provider_fee: v.fee || 0, p_raw: v.raw || null
    });
    if (r && r.status === 'processed') await afterPaid(pay.order_id, r.vendor_ids || []);
    return { payment_status: r.payment_status || (r.status === 'amount_mismatch' ? 'pending' : 'paid'), order_id: pay.order_id, result: r.status };
  }
  if (v.status === 'failed') {
    const r = await rpc('fail_payment', { p_reference: reference, p_status: 'failed', p_reason: (v.raw && v.raw.gateway_response) || 'declined' });
    return { payment_status: (r && r.payment_status) || 'failed', order_id: pay.order_id };
  }
  return { payment_status: pay.status, order_id: pay.order_id, pending: true };
}

// Best-effort: tell the admin and the sellers. A notification failure must never undo a confirmed payment.
async function afterPaid(orderId) {
  const base = process.env.SITE_URL;
  if (!base) return;
  try {
    await fetch(base.replace(/\/+$/, '') + '/api/notify-order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'placed', orderId })
    });
  } catch (_) { /* ignore */ }
}

async function applyEvent(providerId, ev) {
  switch (ev.type) {
    case 'payment.success':
    case 'payment.failed':
      if (!ev.reference) return 'ignored';
      await verifyAndFinalize(ev.reference);   // re-checked with the provider: the webhook body alone is never trusted
      return 'processed';
    case 'refund.processed':
    case 'refund.failed': {
      let q = db().from('refunds').select('*').in('status', ['pending', 'processing']);
      if (ev.providerRefundId) q = q.eq('provider_refund_id', ev.providerRefundId);
      let { data } = await q.limit(1);
      if ((!data || !data.length) && ev.transactionReference) {
        const pay = await paymentByReference(ev.transactionReference);
        if (pay) ({ data } = await db().from('refunds').select('*').eq('payment_id', pay.id).in('status', ['pending', 'processing']).order('id').limit(1));
      }
      if (!data || !data.length) return 'ignored';
      if (ev.type === 'refund.processed') await rpc('apply_refund', { p_refund_id: data[0].id, p_provider_refund_id: ev.providerRefundId || null, p_raw: ev.raw || null });
      else await rpc('fail_refund', { p_refund_id: data[0].id, p_reason: 'failed at provider' });
      return 'processed';
    }
    case 'payout.success':
    case 'payout.failed':
    case 'payout.reversed': {
      if (!ev.reference) return 'ignored';
      const { data } = await db().from('payouts').select('id').eq('reference', ev.reference).maybeSingle();
      if (!data) return 'ignored';
      if (ev.type === 'payout.success') await rpc('complete_payout', { p_payout_id: data.id, p_provider_transfer_id: ev.transferId || null, p_raw: ev.raw || null });
      else if (ev.type === 'payout.failed') await rpc('fail_payout', { p_payout_id: data.id, p_reason: 'failed at provider' });
      else await rpc('reverse_payout', { p_payout_id: data.id, p_reason: 'reversed by provider' });
      return 'processed';
    }
    default: return 'ignored';
  }
}

// Verified, logged, de-duplicated. Returns a summary; throws with status 401 for a bad signature.
async function processWebhook(providerId, rawBody, headers) {
  const provider = providers.get(providerId);
  if (!provider.configured()) throw new HttpError(503, 'Provider not configured', 'payments_not_configured');
  const parsed = provider.parseWebhook(rawBody, headers);     // throws on an invalid signature
  const out = [];
  for (const ev of parsed.events) {
    const rec = await rpc('record_payment_event', {
      p_provider: providerId, p_event_id: ev.eventId, p_type: ev.type, p_reference: ev.reference || null, p_valid: true,
      p_payload: ev.raw || null
    });
    if (!rec.is_new) { out.push({ eventId: ev.eventId, result: 'duplicate' }); continue; }
    try {
      const result = await applyEvent(providerId, ev);
      await rpc('finish_payment_event', { p_id: rec.id, p_status: result === 'ignored' ? 'ignored' : 'processed', p_error: null });
      out.push({ eventId: ev.eventId, result });
    } catch (e) {
      await rpc('finish_payment_event', { p_id: rec.id, p_status: 'error', p_error: String(e.message || e).slice(0, 500) }).catch(() => {});
      throw e;                                               // 5xx: the provider will deliver it again
    }
  }
  return out;
}

async function startRefund({ paymentId, kind, sellerOrderId, amount, reason, by }) {
  const { data: pay } = await db().from('payments').select('*').eq('id', paymentId).maybeSingle();
  if (!pay) throw new HttpError(404, 'Payment not found', 'payment_not_found');
  const provider = providers.get(pay.provider);
  if (!provider.configured()) throw new HttpError(503, 'The payment provider used for this payment is not configured', 'payments_not_configured');
  const reference = newReference('RF');
  const rf = await rpc('request_refund', { p_payment_id: pay.id, p_kind: kind, p_shipment_id: sellerOrderId || null, p_amount: amount || null, p_reason: reason || null, p_by: by || null, p_reference: reference, p_provider: pay.provider });
  let res;
  try {
    res = await provider.refundPayment({ reference: pay.reference, providerTxnId: pay.provider_txn_id, amount: rf.amount, reason, refundReference: reference });
  } catch (e) {
    await rpc('fail_refund', { p_refund_id: rf.id, p_reason: String(e.message || e).slice(0, 300) });
    throw new HttpError(502, 'The provider rejected the refund: ' + (e.message || 'unknown error'), 'refund_failed');
  }
  if (res.status === 'processed') { await rpc('apply_refund', { p_refund_id: rf.id, p_provider_refund_id: res.providerRefundId || null, p_raw: null }); return { refund_id: rf.id, status: 'successful', amount: rf.amount }; }
  if (res.status === 'failed') { await rpc('fail_refund', { p_refund_id: rf.id, p_reason: 'failed at provider' }); throw new HttpError(502, 'The provider could not process the refund', 'refund_failed'); }
  await rpc('mark_refund_processing', { p_refund_id: rf.id, p_provider_refund_id: res.providerRefundId || null });
  return { refund_id: rf.id, status: 'processing', amount: rf.amount };
}

async function startPayout({ vendorId, isTest, by }) {
  const provider = providers.active();
  if (!provider) throw new HttpError(503, 'Payments are not configured, so payouts cannot be sent.', 'payments_not_configured');
  if (!!provider.isTest !== !!isTest) {
    throw new HttpError(409, isTest ? 'These are test balances; they cannot be paid out through a live provider.' : 'These are real balances; the test provider cannot pay them out.', 'test_live_mismatch');
  }
  const { data: acct } = await db().from('vendor_payout_accounts').select('*').eq('vendor_id', vendorId).maybeSingle();
  if (!acct) throw new HttpError(409, 'This seller has not added payout bank details yet.', 'no_payout_account');
  const reference = newLowerRef('po');
  const po = await rpc('prepare_payout', { p_vendor_id: vendorId, p_is_test: !!isTest, p_provider: provider.id, p_reference: reference, p_by: by || null });
  let res;
  try {
    res = await provider.createPayout({ reference, amount: po.amount, reason: 'Marcato seller payout', recipient: {
      name: acct.account_name, bankCode: acct.bank_code, accountNumber: acct.account_number, code: (acct.recipients || {})[provider.id] } });
  } catch (e) {
    await rpc('fail_payout', { p_payout_id: po.id, p_reason: String(e.message || e).slice(0, 300) });
    throw new HttpError(502, 'The provider rejected the transfer: ' + (e.message || 'unknown error'), 'payout_failed');
  }
  if (res.recipientCode && !(acct.recipients || {})[provider.id]) {
    await db().from('vendor_payout_accounts').update({ recipients: { ...(acct.recipients || {}), [provider.id]: res.recipientCode } }).eq('vendor_id', vendorId);
  }
  if (res.status === 'paid') { await rpc('complete_payout', { p_payout_id: po.id, p_provider_transfer_id: res.transferId || null, p_raw: null }); return { payout_id: po.id, status: 'paid', amount: po.amount }; }
  if (res.status === 'failed') { await rpc('fail_payout', { p_payout_id: po.id, p_reason: 'failed at provider' }); throw new HttpError(502, 'The provider could not start the transfer', 'payout_failed'); }
  await rpc('mark_payout_processing', { p_payout_id: po.id, p_transfer_id: res.transferId || null });
  return { payout_id: po.id, status: 'processing', amount: po.amount, needs_approval: !!res.needsApproval };
}

async function checkPayout(payoutId) {
  const { data: po } = await db().from('payouts').select('*').eq('id', payoutId).maybeSingle();
  if (!po) throw new HttpError(404, 'Payout not found', 'payout_not_found');
  if (['paid', 'failed', 'reversed'].includes(po.status)) return { payout_id: po.id, status: po.status };
  const provider = providers.get(po.provider);
  const r = await provider.checkPayoutStatus(po.reference);
  if (r.status === 'paid') await rpc('complete_payout', { p_payout_id: po.id, p_provider_transfer_id: r.transferId || null, p_raw: null });
  else if (r.status === 'failed') await rpc('fail_payout', { p_payout_id: po.id, p_reason: 'failed at provider' });
  else if (r.status === 'reversed') await rpc('reverse_payout', { p_payout_id: po.id, p_reason: 'reversed by provider' });
  const { data: after } = await db().from('payouts').select('status').eq('id', po.id).single();
  return { payout_id: po.id, status: after.status };
}

module.exports = { newReference, verifyAndFinalize, processWebhook, startRefund, startPayout, checkPayout, paymentByReference, afterPaid };
