// Small helpers shared by the payment endpoints (Vercel Node functions).

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code || undefined; }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readRaw(req) {
  if (typeof req.rawBody === 'string' || Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req.body === 'string' ? req.body : await readRaw(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { throw new HttpError(400, 'Body must be JSON', 'bad_json'); }
}

// Wraps a handler: method check + uniform error output. Errors from our SQL functions carry a readable code.
function handler(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) throw new HttpError(405, 'Method not allowed', 'method_not_allowed');
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: e.message || 'Server error', code: e.code || (status >= 500 ? 'server_error' : 'error') });
    }
  };
}

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0];
  const proto = (req.headers['x-forwarded-proto'] || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')).split(',')[0];
  return host ? `${proto}://${host}` : '';
}

module.exports = { HttpError, send, readRaw, readJson, handler, siteUrl };
