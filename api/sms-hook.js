// POST /api/sms-hook - Supabase Auth "Send SMS" hook. Supabase generates the OTP and calls this endpoint instead of its
// built-in SMS providers; we deliver the code through Termii. Supabase signs the call with the Standard Webhooks scheme,
// so the raw body is needed (body parsing is off for this function).
//
// Supabase dashboard: Authentication -> Hooks -> Send SMS -> HTTPS, URL {SITE_URL}/api/sms-hook, generate the secret and
// store it as SEND_SMS_HOOK_SECRET (format "v1,whsec_..."). Also enable Authentication -> Providers -> Phone.
const crypto = require('crypto');
const { readRaw, HttpError } = require('./_lib/http');
const { sendSms } = require('./_lib/sms/termii');

const TOLERANCE_S = 300;

function secretKey() {
  const s = (process.env.SEND_SMS_HOOK_SECRET || '').trim();
  if (!s) throw new HttpError(500, 'Send SMS hook secret is not configured.', 'hook_not_configured');
  return Buffer.from(s.replace(/^v1,whsec_/, '').replace(/^whsec_/, ''), 'base64');
}

function verifySignature(raw, headers, now) {
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sigHeader = headers['webhook-signature'];
  if (!id || !ts || !sigHeader) throw new HttpError(401, 'Missing signature.', 'unauthorized');
  const age = Math.abs((now || Date.now()) / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_S) throw new HttpError(401, 'Stale or invalid timestamp.', 'unauthorized');
  const expected = crypto.createHmac('sha256', secretKey()).update(`${id}.${ts}.${raw}`).digest();
  const ok = String(sigHeader).split(' ').some(part => {
    const [v, sig] = part.split(',');
    if (v !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
  if (!ok) throw new HttpError(401, 'Invalid signature.', 'unauthorized');
}

const brand = () => (process.env.SMS_BRAND || 'Marcato').trim();

module.exports = async (req, res) => {
  const reply = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed', 'method_not_allowed');
    const raw = await readRaw(req);
    verifySignature(raw, req.headers);
    let payload; try { payload = JSON.parse(raw); } catch (_) { throw new HttpError(400, 'Body must be JSON', 'bad_json'); }
    const phone = payload && payload.user && payload.user.phone;
    const otp = payload && payload.sms && payload.sms.otp;
    if (!phone || !otp) throw new HttpError(400, 'Missing phone or otp.', 'bad_payload');
    await sendSms(phone, `Your ${brand()} verification code is ${otp}. It expires in 10 minutes. Never share this code.`);
    return reply(200, {});
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && !e.code) console.error(e);
    // Supabase reads { error: { http_code, message } } from a failed hook and shows the message to the caller.
    return reply(status, { error: { http_code: status, message: e.message || 'Server error' } });
  }
};
module.exports.verifySignature = verifySignature;
module.exports.config = { api: { bodyParser: false } };
