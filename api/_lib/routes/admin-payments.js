// POST /api/admin-payments { action, ... }   admin only (session token + ADMIN_EMAIL)
//   status                                   which provider is active and what is missing
//   verify         { reference }             re-check a pending payment with the provider
//   refund         { payment_id, kind: 'full'|'partial'|'seller', seller_order_id?, amount?, reason }
//   refresh_eligibility                      apply the payout policy now
//   create_payout  { vendor_id, is_test }    pay a seller everything currently eligible
//   check_payout   { payout_id }             ask the provider about a payout in progress
const { handler, send, readJson, HttpError } = require('../http');
const { requireAdmin } = require('../auth');
const { rpc } = require('../db');
const providers = require('../payments');
const core = require('../payments/core');

module.exports = handler(['POST'], async (req, res) => {
  const admin = await requireAdmin(req);
  const b = await readJson(req);
  switch (b.action) {
    case 'status': return send(res, 200, providers.status());
    case 'verify': return send(res, 200, await core.verifyAndFinalize(String(b.reference || '')));
    case 'refund': {
      if (!['full', 'partial', 'seller'].includes(b.kind)) throw new HttpError(400, 'kind must be full, partial or seller', 'bad_request');
      const out = await core.startRefund({ paymentId: Number(b.payment_id), kind: b.kind, sellerOrderId: b.seller_order_id ? Number(b.seller_order_id) : null, amount: b.amount ? Number(b.amount) : null, reason: String(b.reason || '').slice(0, 300), by: admin.email });
      return send(res, 200, out);
    }
    case 'refresh_eligibility': return send(res, 200, { updated: await rpc('refresh_payout_eligibility', { p_order_id: null }) });
    case 'create_payout': {
      if (!b.vendor_id) throw new HttpError(400, 'vendor_id is required', 'bad_request');
      return send(res, 200, await core.startPayout({ vendorId: String(b.vendor_id), isTest: !!b.is_test, by: admin.email }));
    }
    case 'check_payout': return send(res, 200, await core.checkPayout(Number(b.payout_id)));
    default: throw new HttpError(400, 'Unknown action', 'bad_request');
  }
});
