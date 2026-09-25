// POST /api/checkout
// { items: [{ product_id, qty, size?, color? }], delivery: { name, phone, email?, line1, city?, state?, lat?, lng?, display_name? }, method?, order_id? }
//
// Creates the parent order, one seller order per seller, the items and a pending payment in a single database
// transaction (prices, stock, sellers and fees are all read from the database, never from the browser), then asks the
// configured payment provider for a payment link. The order only becomes "paid" when the provider confirms it
// server side (webhook or /api/payment-verify).
//
// Passing order_id retries payment for an order that is still unpaid.
const crypto = require('crypto');
const { handler, send, readJson, siteUrl, HttpError } = require('../http');
const { db, rpc } = require('../db');
const { optionalUser } = require('../auth');
const providers = require('../payments');
const { newReference } = require('../payments/core');

/* The colour / size a customer picked, as the small object stored on order_items.variants: {"Colour":"Black","Size":"XL"}. */
function variantsOf(i) {
  const v = {}, color = String((i && i.color) || '').trim().slice(0, 60), size = String((i && i.size) || '').trim().slice(0, 60);
  if (color) v.Colour = color;
  if (size) v.Size = size;
  return Object.keys(v).length ? v : null;
}

/* Writes each line's choices onto the order_items rows create_checkout just made (that database function only knows
   product ids and quantities). Matches by product, preferring the same quantity. If the database merged two lines of
   one product into a single row, the choices are written as one readable "Options" note instead of dropping one.
   Best effort by design: the order and payment already exist, so this must never fail a checkout (it also quietly does
   nothing until migration_variants.sql has added the column). */
async function saveVariants(orderId, lines) {
  const want = (lines || []).filter(l => l.variants);
  if (!orderId || !want.length) return;
  try {
    const { data: rows, error } = await db().from('order_items').select('id, product_id, qty').eq('order_id', orderId).order('id');
    if (error || !Array.isArray(rows)) return;
    const used = new Set();
    const byProduct = new Map();
    want.forEach(l => { if (!byProduct.has(l.product_id)) byProduct.set(l.product_id, []); byProduct.get(l.product_id).push(l); });
    for (const [pid, ls] of byProduct) {
      const mine = rows.filter(r => Number(r.product_id) === pid);
      if (mine.length >= ls.length) {
        for (const l of ls) {
          const row = mine.find(r => !used.has(r.id) && Number(r.qty) === l.qty) || mine.find(r => !used.has(r.id));
          if (!row) continue;
          used.add(row.id);
          await db().from('order_items').update({ variants: l.variants }).eq('id', row.id);
        }
      } else if (mine.length) {
        const note = ls.map(l => Object.values(l.variants).join(' / ') + ' x' + l.qty).join('; ');
        await db().from('order_items').update({ variants: { Options: note.slice(0, 200) } }).eq('id', mine[0].id);
      }
    }
  } catch (e) { /* column not added yet, or a transient error: the order itself is safe */ }
}

const routeHandler = handler(['POST'], async (req, res) => {
  const provider = providers.active();
  if (!provider) throw new HttpError(503, 'Online payment is not available yet.', 'payments_not_configured');
  const body = await readJson(req);
  const user = await optionalUser(req);
  const method = provider.methods().some(m => m.id === body.method) ? body.method : 'any';
  const reference = newReference('MCT');
  let co, email, guestToken = null, lines = [];

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
    lines = body.items.map((i, n) => ({ product_id: items[n].product_id, qty: items[n].qty, variants: variantsOf(i) }));
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
    await saveVariants(co && co.order_id, lines);
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

module.exports = routeHandler;
module.exports.variantsOf = variantsOf;      // exported for tests
module.exports.saveVariants = saveVariants;
