// POST /api/payment-verify { reference }
// Called when the customer returns from the payment page. The answer comes from the provider, not from the browser.
const { handler, send, readJson, HttpError } = require('./_lib/http');
const { verifyAndFinalize } = require('./_lib/payments/core');

module.exports = handler(['POST'], async (req, res) => {
  const { reference } = await readJson(req);
  if (!reference || typeof reference !== 'string' || reference.length > 80) throw new HttpError(400, 'reference is required', 'bad_reference');
  const r = await verifyAndFinalize(reference);
  send(res, 200, { payment_status: r.payment_status, order_id: r.order_id, pending: !!r.pending });
});
