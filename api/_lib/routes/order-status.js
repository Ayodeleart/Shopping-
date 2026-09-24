// GET /api/order-status?order_id=...&token=...   (token = the guest token returned at checkout; signed-in buyers send their session)
const { handler, send, HttpError } = require('../http');
const { db } = require('../db');
const { optionalUser } = require('../auth');

module.exports = handler(['GET'], async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const orderId = Number(url.searchParams.get('order_id')), token = url.searchParams.get('token') || '';
  if (!orderId) throw new HttpError(400, 'order_id is required', 'bad_request');
  const user = await optionalUser(req);
  const { data: o } = await db().from('orders').select('id, user_id, guest_token, status, payment_status, payment_reference, payment_method, total, subtotal, delivery_fee, service_fee, tax, refunded_amount, currency, created_at, paid_at, is_test, delivery').eq('id', orderId).maybeSingle();
  if (!o) throw new HttpError(404, 'Order not found', 'order_not_found');
  const ok = (o.user_id && user && o.user_id === user.id) || (o.guest_token && token && o.guest_token === token);
  if (!ok) throw new HttpError(403, 'This is not your order', 'forbidden');
  const { data: subs } = await db().from('shipments').select('id, status, subtotal, tracking_number, carrier_name, vendors(business_name), order_items(name, qty, price, line_total)').eq('order_id', o.id);
  const { guest_token, user_id, ...safe } = o;
  send(res, 200, { order: safe, sellers: (subs || []).map(s => ({ id: s.id, seller: (s.vendors && s.vendors.business_name) || 'Maccato', status: s.status, subtotal: s.subtotal, tracking_number: s.tracking_number, carrier_name: s.carrier_name, items: s.order_items })) });
});
