// Auth helpers + a small in-memory rate limiter shared by the AI endpoints.
const { getAdmin } = require('../db');

const adminEmails = () => (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function bearer(req) {
  return String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '').replace(/^Bearer\s+/i, '').trim();
}

/** Verified Supabase user for the request, or null. Never trusts anything sent in the body. */
async function getUser(req, db) {
  const token = bearer(req);
  if (!token) return null;
  try {
    const { data, error } = await (db || getAdmin()).auth.getUser(token);
    return error || !data || !data.user ? null : data.user;
  } catch { return null; }
}

/** Approved vendor or admin (same rule as api/brand-search.js). */
async function isVendorOrAdmin(user, db) {
  if (!user) return false;
  if (adminEmails().includes(String(user.email || '').toLowerCase())) return true;
  const { data } = await (db || getAdmin()).from('vendors').select('status').eq('id', user.id).maybeSingle();
  return !!data && data.status === 'approved';
}

function clientIp(req) {
  const xf = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Sliding window per warm serverless instance. It stops bursts and accidental loops; it is NOT a global quota
// (each Vercel instance has its own memory). For a hard cap, back it with a database/Redis counter.
const buckets = new Map();
function rateLimit(key, limit, windowMs, now) {
  const t = now || Date.now();
  const arr = (buckets.get(key) || []).filter(x => t - x < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (t - arr[0])) / 1000)) };
  }
  arr.push(t); buckets.set(key, arr);
  if (buckets.size > 5000) { for (const [k, v] of buckets) if (!v.length || t - v[v.length - 1] > windowMs) buckets.delete(k); }
  return { ok: true };
}
const _resetRateLimits = () => buckets.clear();

// one-line, content-free usage log (no prompts, no replies, no personal data)
function logUsage(evt, fields) {
  try { console.log(JSON.stringify(Object.assign({ evt, t: new Date().toISOString() }, fields))); } catch { /* ignore */ }
}

module.exports = { getUser, isVendorOrAdmin, clientIp, rateLimit, logUsage, bearer, _resetRateLimits };
