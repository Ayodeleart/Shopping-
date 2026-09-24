// GET /api/geocode?q=12 allen avenue ikeja      -> address suggestions
// GET /api/geocode?lat=6.6&lon=3.35              -> the address at a point ("use my location")
//
// Address search uses Nominatim (https://github.com/osm-search/Nominatim), OpenStreetMap's geocoder.
// The public server (nominatim.openstreetmap.org) has a usage policy this endpoint follows: an identifying
// User-Agent, no more than 1 request per second, cached results, and searches only when the customer asks
// (the checkout page searches on the button / Enter key, never on every keystroke).
// For real traffic point NOMINATIM_URL at your own Nominatim server or a hosted one.
//
// Environment (all optional): NOMINATIM_URL, NOMINATIM_CONTACT (an email for the User-Agent), GEOCODE_COUNTRIES (default "ng")
const { handler, send, HttpError } = require('./_lib/http');

const BASE = () => (process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
const isPublic = () => !process.env.NOMINATIM_URL || /nominatim\.openstreetmap\.org/.test(process.env.NOMINATIM_URL);

const cache = new Map();              // key -> { at, value }
const hits = new Map();               // ip -> [timestamps]
let chain = Promise.resolve();        // serialises upstream calls
let lastCall = 0;

function throttled(fn) {
  const run = chain.then(async () => {
    if (isPublic()) { const wait = 1100 - (Date.now() - lastCall); if (wait > 0) await new Promise(r => setTimeout(r, wait)); }
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

function shape(r) {
  const a = r.address || {};
  const road = [a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' ');
  return {
    display_name: r.display_name,
    line1: road || a.neighbourhood || a.suburb || String(r.display_name || '').split(',')[0],
    area: a.suburb || a.neighbourhood || a.city_district || '',
    city: a.city || a.town || a.village || a.municipality || a.county || a.state_district || '',
    state: a.state || '',
    postcode: a.postcode || '',
    lat: Number(r.lat), lon: Number(r.lon)
  };
}

async function upstream(path) {
  const contact = process.env.NOMINATIM_CONTACT || process.env.SITE_URL || 'no-contact-set';
  const res = await fetch(BASE() + path, { headers: { 'User-Agent': `Marcato-Marketplace/1.0 (${contact})`, 'Accept-Language': 'en', Accept: 'application/json' } });
  if (!res.ok) throw new HttpError(502, 'Address search is unavailable right now.', 'geocode_unavailable');
  return res.json();
}

module.exports = handler(['GET'], async (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 20) throw new HttpError(429, 'Too many searches. Wait a moment.', 'rate_limited');
  hits.set(ip, recent.concat(now));

  const url = new URL(req.url, 'http://x');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  const lat = parseFloat(url.searchParams.get('lat')), lon = parseFloat(url.searchParams.get('lon'));
  let path;
  if (q.length >= 3) {
    path = `/search?format=jsonv2&addressdetails=1&limit=6&dedupe=1&countrycodes=${encodeURIComponent(process.env.GEOCODE_COUNTRIES || 'ng')}&q=${encodeURIComponent(q)}`;
  } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
    path = `/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
  } else throw new HttpError(400, 'Type at least 3 characters of the address.', 'bad_request');

  const hit = cache.get(path);
  if (hit && now - hit.at < 3600000) return send(res, 200, { results: hit.value, cached: true });
  const data = await throttled(() => upstream(path));
  const results = (Array.isArray(data) ? data : (data && !data.error ? [data] : [])).map(shape);
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(path, { at: now, value: results });
  send(res, 200, { results });
});
