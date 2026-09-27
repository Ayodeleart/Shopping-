// /api/remove-bg.js — secure, server-side product cutout pipeline.
//
// Used by Marcato's existing admin and approved-vendor upload forms for Beauty
// and Home & Decor. The original upload always remains products.image_url. This
// endpoint returns a separate transparent PNG with a soft contact shadow.
//
// Pipeline (adapted from Ayodeleart/Wood/app/api/admin/upload/route.js):
// source in Marcato Supabase Storage -> remove.bg -> untouched furniture cutout
// -> silhouette-derived contact shadow -> transparent PNG -> cached Storage URL.
// No key is exposed to a browser and no second image service is used.

const crypto = require('crypto');
const sharp = require('sharp');
const { getAdmin } = require('./_lib/db');
const { requireAdminOrApprovedVendor } = require('./_lib/auth');

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 45 * 1000;
const CUTOUT_BUCKET = 'avatars';
/* Version the cache because v1 (beauty-cutouts) did not contain a shadow. An
   old cutout is upgraded locally with sharp, without spending another API call. */
const CUTOUT_DIR = 'product-cutouts-v2';
const LEGACY_CUTOUT_DIR = 'beauty-cutouts';
const REMOVE_BG_ENDPOINT = 'https://api.remove.bg/v1.0/removebg';

function isAllowedSourceUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  const ref = (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('/')[0];
  if (!ref) return true; // local development only
  return u.hostname === ref && u.pathname.indexOf('/storage/v1/object/public/') === 0;
}

function sourceHash(rawUrl) {
  return crypto.createHash('sha256').update(String(rawUrl)).digest('hex');
}
function cachePath(rawUrl) { return CUTOUT_DIR + '/' + sourceHash(rawUrl) + '.png'; }
function legacyCachePath(rawUrl) { return LEGACY_CUTOUT_DIR + '/' + sourceHash(rawUrl) + '.png'; }
function publicUrl(admin, path) { return admin.storage.from(CUTOUT_BUCKET).getPublicUrl(path).data.publicUrl; }

function existsValue(data) { return data === true || !!(data && data.exists === true); }
async function storageExists(bucket, path) {
  try {
    const r = await bucket.exists(path);
    return existsValue(r && r.data);
  } catch (e) { return false; }
}

/* Wood's actual contact-shadow approach: take only the cutout's alpha, squash
   that silhouette into a low footprint, blur it, reduce opacity, then composite
   it beneath the original PNG. The furniture pixels are never resized, cropped,
   recoloured or flattened, so its proportions, edge detail and texture remain. */
async function addGroundShadow(transparentPngBuffer) {
  const base = sharp(transparentPngBuffer).ensureAlpha();
  const meta = await base.metadata();
  const width = meta.width, height = meta.height;
  if (!width || !height) throw new Error('The cutout has no readable dimensions.');

  const footprintHeight = Math.max(1, Math.round(height * 0.30));
  const offsetTop = Math.max(0, height - footprintHeight - Math.round(height * 0.045));
  const sigma = Math.max(0.3, Math.min(30, Math.min(width, height) * 0.035));
  const alpha = await sharp(transparentPngBuffer).ensureAlpha().extractChannel('alpha')
    .resize(width, footprintHeight, { fit: 'fill' }).blur(sigma).raw().toBuffer();

  const rgba = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < footprintHeight; y++) {
    const dy = offsetTop + y;
    if (dy >= height) break;
    for (let x = 0; x < width; x++) {
      const srcAlpha = alpha[y * width + x] || 0;
      rgba[(dy * width + x) * 4 + 3] = Math.round(srcAlpha * 0.42);
    }
  }
  const shadow = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow, left: 0, top: 0 }, { input: transparentPngBuffer, left: 0, top: 0 }])
    .png({ compressionLevel: 9 }).toBuffer();
}

async function saveCutout(bucket, path, buffer) {
  const { error } = await bucket.upload(path, buffer, {
    contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable', upsert: true
  });
  if (error) throw error;
}

const handler = async (req, res) => {
  try {
    await requireAdminOrApprovedVendor(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message || 'Please sign in as an admin or approved vendor.' });
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
  const bucket = admin.storage.from(CUTOUT_BUCKET);

  /* 1) deterministic v2 cache: the same original + pipeline version is never
        sent to remove.bg twice. */
  if (await storageExists(bucket, path)) {
    return res.status(200).json({ url: publicUrl(admin, path), cached: true, shadow: true });
  }

  /* 2) If Beauty already made a v1 transparent cutout, add the shadow locally
        and promote it into v2. This avoids paying to remove the same background. */
  const legacyPath = legacyCachePath(url);
  if (await storageExists(bucket, legacyPath) && typeof bucket.download === 'function') {
    try {
      const old = await bucket.download(legacyPath);
      if (!old.error && old.data) {
        const raw = Buffer.from(await old.data.arrayBuffer());
        const upgraded = await addGroundShadow(raw);
        await saveCutout(bucket, path, upgraded);
        return res.status(200).json({ url: publicUrl(admin, path), cached: true, upgraded: true, shadow: true });
      }
    } catch (e) { /* a corrupt/undownloadable legacy file falls through */ }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    /* 3) Read and bound the store-owned source before sending it to remove.bg. */
    const src = await fetch(url, { signal: ctrl.signal });
    if (!src.ok) return res.status(200).json({ url: null, error: 'source-unavailable' });
    if (Number(src.headers.get('content-length') || 0) > MAX_SOURCE_BYTES) {
      return res.status(200).json({ url: null, error: 'source-too-large' });
    }
    const srcBuf = Buffer.from(await src.arrayBuffer());
    if (!srcBuf.byteLength || srcBuf.byteLength > MAX_SOURCE_BYTES) {
      return res.status(200).json({ url: null, error: 'source-too-large' });
    }

    /* 4) API key and source bytes stay on the server. */
    const form = new FormData();
    form.append('image_file', new Blob([srcBuf]), 'product.jpg');
    form.append('size', 'auto');
    form.append('format', 'png');
    const apiRes = await fetch(REMOVE_BG_ENDPOINT, {
      method: 'POST', headers: { 'X-Api-Key': apiKey }, body: form, signal: ctrl.signal
    });
    if (!apiRes.ok) {
      let detail = '';
      try {
        const payload = await apiRes.json();
        detail = payload && payload.errors && payload.errors[0] && payload.errors[0].title || '';
      } catch (e) { /* non-JSON upstream error */ }
      return res.status(502).json({ url: null, error: 'service-' + apiRes.status, message: detail });
    }
    const transparent = Buffer.from(await apiRes.arrayBuffer());
    if (!transparent.byteLength) return res.status(502).json({ url: null, error: 'service-empty' });

    let processed;
    try { processed = await addGroundShadow(transparent); }
    catch (e) {
      /* A shadow failure must not throw away a valid cutout. It remains a safe,
         transparent fallback and CSS supplies a lighter drop shadow. */
      processed = transparent;
    }
    await saveCutout(bucket, path, processed);
    return res.status(200).json({ url: publicUrl(admin, path), cached: false, shadow: processed !== transparent });
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
    return res.status(504).json({ url: null, error: aborted ? 'timeout' : 'failed', message: (e && e.message) || String(e) });
  } finally {
    clearTimeout(timer);
  }
};

handler.__test = {
  isAllowedSourceUrl, cachePath, legacyCachePath, addGroundShadow,
  CUTOUT_BUCKET, CUTOUT_DIR, LEGACY_CUTOUT_DIR
};
module.exports = handler;
