// Server-side Supabase client (service role). This key must only ever exist in the server environment.
const { createClient } = require('@supabase/supabase-js');
const { HttpError } = require('./http');

let client = null;

function db() {
  if (client) return client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', 'server_not_configured');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
function setDb(c) { client = c; }   // tests

// Older name used by some endpoints (notify-*, assistant, admin-vendors, brand-search): same client.
function getAdmin() { return db(); }
function siteUrlFrom(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  return host ? 'https://' + host : '';
}

// Our SQL functions raise short codes such as insufficient_stock:Blender; turn them into friendly 4xx errors.
const FRIENDLY = {
  empty_cart: 'Your cart is empty.',
  delivery_details_missing: 'Add your name, phone number and delivery address.',
  bad_quantity: 'One of the quantities is not valid.',
  nothing_to_pay: 'There is nothing to pay.',
  payment_not_found: 'Payment not found.',
  payment_not_refundable: 'This payment cannot be refunded.',
  amount_exceeds_refundable: 'That is more than can still be refunded.',
  refund_already_in_progress: 'A refund is already in progress for this order.',
  nothing_left_to_refund: 'Nothing is left to refund.',
  nothing_to_pay_out: 'This seller has nothing eligible to pay out yet.',
  order_already_paid: 'This order is already paid.',
  order_cancelled: 'This order was cancelled.'
};
function dbError(error) {
  const msg = String(error.message || '');
  const code = msg.split(':')[0];
  const detail = msg.includes(':') ? msg.slice(msg.indexOf(':') + 1) : '';
  if (code === 'insufficient_stock') return new HttpError(409, `Not enough stock for ${detail}.`, code);
  if (code === 'product_not_found') return new HttpError(409, 'A product in your cart is no longer available.', code);
  if (code === 'seller_unavailable') return new HttpError(409, `${detail} is not available from this seller right now.`, code);
  if (FRIENDLY[code]) return new HttpError(error.code === 'P0002' ? 404 : 409, FRIENDLY[code], code);
  return Object.assign(new HttpError(500, msg || 'Database error', 'db_error'), { cause: error });
}

async function rpc(name, args) {
  const { data, error } = await db().rpc(name, args || {});
  if (error) throw dbError(error);
  return data;
}

module.exports = { db, setDb, rpc, dbError, getAdmin, siteUrlFrom };
