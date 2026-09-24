// /api/brand-search.js
// Deploy target: Vercel (same as the other /api functions).
//
// Vendors and the admin type a brand name while adding a product; this function looks it up on
// logo.dev and returns [{ name, domain, logo_url }]. The logo.dev SECRET key lives only here.
//
// Required environment variables (Vercel project settings, NEVER in the repo):
//   LOGO_DEV_SECRET_KEY        = sk_...  (logo.dev dashboard -> API keys)  used for the search call
//   LOGO_DEV_PUBLISHABLE_KEY   = pk_...  (same page)  goes into the logo image URLs (safe to be public)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL   (already set for admin-vendors.js)
//
// Only signed-in approved vendors and admins can call it, so nobody can burn your logo.dev quota.
// If LOGO_DEV_PUBLISHABLE_KEY is missing, logos fall back to a low-resolution favicon.

const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();   // per warm instance: repeated searches cost nothing

function getAdminEmails() {
  return (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function logoUrl(domain) {
  const pk = process.env.LOGO_DEV_PUBLISHABLE_KEY;
  if (pk) return `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(pk)}&size=200&format=png`;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

async function isAllowed(user) {
  if (getAdminEmails().includes((user.email || '').toLowerCase())) return true;
  const { data } = await supabaseAdmin.from('vendors').select('status').eq('id', user.id).maybeSingle();
  return !!data && data.status === 'approved';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });
    if (!(await isAllowed(user))) return res.status(403).json({ error: 'Not allowed' });

    const q = String((req.query && req.query.q) || '').trim().slice(0, 60);
    if (q.length < 2) return res.status(200).json({ results: [] });

    const secret = process.env.LOGO_DEV_SECRET_KEY;
    if (!secret) return res.status(503).json({ error: 'Brand search is not configured (LOGO_DEV_SECRET_KEY missing)' });

    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < CACHE_MS) return res.status(200).json({ results: hit.results });

    const r = await fetch(`https://api.logo.dev/search?q=${encodeURIComponent(q)}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });
    if (!r.ok) return res.status(502).json({ error: `Brand lookup failed (${r.status})` });

    const rows = await r.json();
    const seen = new Set();
    const results = (Array.isArray(rows) ? rows : [])
      .filter(x => x && x.name && x.domain)
      .filter(x => { const d = String(x.domain).toLowerCase(); if (seen.has(d)) return false; seen.add(d); return true; })
      .slice(0, 10)
      .map(x => ({ name: String(x.name), domain: String(x.domain).toLowerCase(), logo_url: logoUrl(String(x.domain).toLowerCase()) }));

    if (cache.size > 500) cache.clear();
    cache.set(key, { t: Date.now(), results });
    return res.status(200).json({ results });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
