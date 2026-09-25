// Identifies the caller from the Supabase session token the browser sends as `Authorization: Bearer <token>`.
const { db } = require('./db');
const { HttpError } = require('./http');

let verifier = async (token) => {
  const { data, error } = await db().auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
};
function setVerifier(fn) { verifier = fn; }   // tests

function tokenOf(req) {
  const h = req.headers.authorization || '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

async function optionalUser(req) {
  const t = tokenOf(req);
  return t ? await verifier(t) : null;
}
async function requireUser(req) {
  const u = await optionalUser(req);
  if (!u) throw new HttpError(401, 'Please sign in.', 'unauthorized');
  return u;
}
function adminEmails() {
  return (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}
async function requireAdmin(req) {
  const u = await requireUser(req);
  if (!adminEmails().includes((u.email || '').toLowerCase())) throw new HttpError(403, 'Not an admin account', 'forbidden');
  return u;
}
/* Admin, or a vendor whose own account is approved — used by endpoints (like background
   removal) that a vendor legitimately triggers for their own products, not only the store owner. */
async function requireAdminOrApprovedVendor(req) {
  const u = await requireUser(req);
  if (adminEmails().includes((u.email || '').toLowerCase())) return u;
  const { data, error } = await db().from('vendors').select('status').eq('id', u.id).maybeSingle();
  if (error || !data || data.status !== 'approved') throw new HttpError(403, 'Admin or approved vendor account required', 'forbidden');
  return u;
}

module.exports = { optionalUser, requireUser, requireAdmin, requireAdminOrApprovedVendor, setVerifier };
