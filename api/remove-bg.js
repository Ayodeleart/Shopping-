// /api/remove-bg.js
// Deploy target: Vercel (Node serverless function).
//
// Secure, server-side background removal for Beauty product photos.
//
//   POST { url }  (or GET ?url=)   ->   { url }        on success / cache hit
//                                        { error }      otherwise (client keeps the original photo)
//
// Pipeline:  original photo (in Supabase Storage) -> remove.bg API -> transparent
// PNG cached back into Storage at avatars/beauty-cutouts/<hash>.png.
// The same image is NEVER processed twice: the cache path is a hash of the
// source URL and is checked before the (paid) API call.
//
// Required environment variables (Vercel project settings — never in the repo):
//   SUPABASE_URL               = https://qmwlphribvncdtgzbixt.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  = service_role key (server only)
//   REMOVE_BG_API_KEY          = https://www.remove.bg/api  (server only)
//
// The API key only ever lives in Vercel env vars. Client code never sees it.
// If the key is missing or the service fails, this returns an error and the
// caller falls back to the original photo — the page never breaks.

const crypto = require('crypto');
const { getAdmin } = require('./_lib/db');
const { requireAdmin } = require('./_lib/auth');

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;   // 10 MB
const TIMEOUT_MS = 45 * 1000;
const CUTOUT_BUCKET = 'avatars';
const CUTOUT_DIR = 'beauty-cutouts';
const REMOVE_BG_ENDPOINT = 'https://api.remove.bg/v1.0/removebg';

/* Only URLs inside this project's own Supabase Storage public path are accepted,
   so the function can't be pointed at arbitrary hosts (SSRF protection). */
function isAllowedSourceUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  const ref = (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('/')[0];
  if (!ref) return true; // SUPABASE_URL not set locally: allow any https URL (dev only)
  return u.hostname === ref && u.pathname.indexOf('/storage/v1/object/public/') === 0;
}

/* Deterministic cache path for a source URL — same image, same path, forever. */
function cachePath(rawUrl) {
  return CUTOUT_DIR + '/' + crypto.createHash('sha256').update(String(rawUrl)).digest('hex') + '.png';
}

function publicUrl(admin, path) {
  return admin.storage.from(CUTOUT_BUCKET).getPublicUrl(path).data.publicUrl;
}

const handler = async (req, res) => {
  /* Admin-only: each call can spend a paid remove.bg credit, so anyone who could
     call this endpoint could run up the store's bill. Require the same admin
     session the rest of the admin dashboard requires. */
  try {
    await requireAdmin(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message || 'Please sign in as an admin.' });
  }

  const body = (req.method === 'POST' && req.body) || {};
  const url = body.url || (req.query && req.query.url) || '';

  if (!isAllowedSourceUrl(url)) {
    return res.status(400).json({ error: 'Only this store\'s Supabase Storage images can be processed.' });
  }

  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ url: null, error: 'not-configured', message: 'Set REMOVE_BG_API_KEY in the Vercel environment to enable background removal.' });
  }

  let admin;
  try { admin = getAdmin(); } catch (e) {
    return res.status(500).json({ error: 'Server storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).' });
  }

  const path = cachePath(url);

  /* 1) cache: never re-run removal for the same image */
  try {
    const { data } = await admin.storage.from(CUTOUT_BUCKET).exists(path);
    if (data && data.exists !== false) return res.status(200).json({ url: publicUrl(admin, path), cached: true });
  } catch (e) { /* fall through to processing */ }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    /* 2) fetch the source image (size-limited) */
    const src = await fetch(url, { signal: ctrl.signal });
    if (!src.ok) return res.status(200).json({ url: null, error: 'source-unavailable' });
    if (Number(src.headers.get('content-length') || 0) > MAX_SOURCE_BYTES) {
      return res.status(200).json({ url: null, error: 'source-too-large' });
    }
    const srcBuf = Buffer.from(await src.arrayBuffer());
    if (srcBuf.byteLength > MAX_SOURCE_BYTES) return res.status(200).json({ url: null, error: 'source-too-large' });

    /* 3) call the background-removal service (key stays server-side) */
    const form = new FormData();
    form.append('image_url', url);
    form.append('size', 'auto');
    form.append('format', 'png');
    const apiRes = await fetch(REMOVE_BG_ENDPOINT, {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: form,
      signal: ctrl.signal
    });
    if (!apiRes.ok) {
      let detail = '';
      try { detail = (await apiRes.json()).errors && apiRes.json().errors[0] && apiRes.json().errors[0].title || ''; } catch (e) { /* ignore */ }
      return res.status(502).json({ url: null, error: 'service-' + apiRes.status, message: detail });
    }
    const outBuf = Buffer.from(await apiRes.arrayBuffer());
    if (!outBuf.byteLength) return res.status(502).json({ url: null, error: 'service-empty' });

    /* 4) cache the transparent PNG back into Storage */
    const { error: upErr } = await admin.storage.from(CUTOUT_BUCKET).upload(path, outBuf, {
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable',
      upsert: true
    });
    if (upErr) return res.status(500).json({ url: null, error: 'storage-save-failed', message: upErr.message });

    return res.status(200).json({ url: publicUrl(admin, path), cached: false });
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
    return res.status(504).json({ url: null, error: aborted ? 'timeout' : 'failed', message: (e && e.message) || String(e) });
  } finally {
    clearTimeout(timer);
  }
};

/* exposed for unit tests (the handler itself needs the network) */
handler.__test = { isAllowedSourceUrl, cachePath, CUTOUT_BUCKET, CUTOUT_DIR };
module.exports = handler;
