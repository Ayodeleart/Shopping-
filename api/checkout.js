// POST /api/checkout
// { items: [{ product_id, qty }], delivery: { name, phone, email?, line1, city?, state?, lat?, lng?, display_name? }, method?, order_id? }
//
// Creates the parent order, one seller order per seller, the items and a pending payment in a single database
// transaction (prices, stock, sellers and fees are all read from the database, never from the browser), then asks the
// configured payment provider for a payment link. The order only becomes "paid" when the provider confirms it
// server side (webhook or /api/payment-verify).
//
// Passing order_id retries payment for an order that is still unpaid.
const crypto = require('crypto');
const { handler, send, readJson, siteUrl, HttpError } = require('./_lib/http');
const { db, rpc } = require('./_lib/db');
const { optionalUser } = require('./_lib/auth');
const providers = require('./_lib/payments');
const { newReference } = require('./_lib/payments/core');

module.exports = handler(['POST'], async (req, res) => {
  const provider = providers.active();
  if (!provider) throw new HttpError(503, 'Online payment is not available yet.', 'payments_not_configured');
  const body = await readJson(req);
  const user = await optionalUser(req);
  const method = provider.methods().some(m => m.id === body.method) ? body.method : 'any';
  const reference = newReference('MCT');
  let co, email, guestToken = null;

  if (body.order_id) {
    // retry an unpaid order: only its owner (or the guest holding its token) may do this
    const { data: o } = await db().from('orders').select('id, user_id, email, guest_token, payment_status').eq('id', body.order_id).maybeSingle();
    if (!o) throw new HttpError(404, 'Order not found', 'order_not_found');
    const owner = (o.user_id && user && o.user_id === user.id) || (o.guest_token && body.guest_token && o.guest_token === body.guest_token);
    if (!owner) throw new HttpError(403, 'This is not your order', 'forbidden');
    email = o.email || (user && user.email);
    co = await rpc('create_payment_attempt', { p_order_id: o.id, p_provider: provider.id, p_is_test: !!provider.isTest, p_reference: reference, p_method: method });
    guestToken = o.user_id ? null : o.guest_token;
  } else {
    const d = body.delivery || {};
    email = (user && user.email) || String(d.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Add an email address so we can send your receipt.', 'email_required');
    if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, 'Your cart is empty.', 'empty_cart');
    guestToken = user ? null : crypto.randomBytes(18).toString('hex');
    const items = body.items.map(i => ({ product_id: Number(i.product_id), qty: Math.floor(Number(i.qty)) }));
    if (items.some(i => !Number.isFinite(i.product_id) || !Number.isFinite(i.qty))) throw new HttpError(400, 'Invalid cart', 'bad_cart');
    const delivery = {
      name: String(d.name || '').trim().slice(0, 120), phone: String(d.phone || '').trim().slice(0, 40), email,
      line1: String(d.line1 || '').trim().slice(0, 240), city: String(d.city || '').trim().slice(0, 80), state: String(d.state || '').trim().slice(0, 80),
      lat: Number.isFinite(Number(d.lat)) && d.lat !== null && d.lat !== '' ? Number(d.lat) : null,
      lng: Number.isFinite(Number(d.lng)) && d.lng !== null && d.lng !== '' ? Number(d.lng) : null,
      display_name: String(d.display_name || '').slice(0, 300)
    };
    co = await rpc('create_checkout', {
      p_user_id: user ? user.id : null, p_email: email, p_delivery: delivery, p_items: items, p_provider: provider.id,
      p_is_test: !!provider.isTest, p_reference: reference, p_guest_token: guestToken, p_method: method
    });
  }

  let init;
  try {
    init = await provider.initializePayment({
      reference, amount: co.amount, currency: co.currency || 'NGN', email, method,
      callbackUrl: siteUrl(req) + '/?pay_return=1', metadata: { order_id: co.order_id, reference }
    });
  } catch (e) {
    await rpc('fail_payment', { p_reference: reference, p_status: 'failed', p_reason: 'could not start: ' + String(e.message || e).slice(0, 200) }).catch(() => {});
    throw new HttpError(502, 'We could not start the payment. Please try again.', 'provider_error');
  }
  await db().from('payments').update({ authorization_url: init.authorizationUrl, updated_at: new Date().toISOString() }).eq('reference', reference);

  send(res, 200, {
    order_id: co.order_id, reference, provider: provider.id, is_test: !!provider.isTest, authorization_url: init.authorizationUrl,
    amount: co.amount, breakdown: { subtotal: co.subtotal, delivery_fee: co.delivery_fee, service_fee: co.service_fee, tax: co.tax },
    guest_token: guestToken
  });
});
