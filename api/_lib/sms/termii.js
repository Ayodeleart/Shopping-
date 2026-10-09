// Termii SMS delivery (https://developers.termii.com). Only the "send one SMS" call is used: Supabase Auth generates
// and checks the OTP itself, we just deliver the text (see api/sms-hook.js).
// Env: TERMII_API_KEY, TERMII_SENDER_ID (must be approved in the Termii dashboard),
//      TERMII_BASE_URL (default https://v4.api.termii.com - copy the base URL shown in your Termii dashboard),
//      TERMII_CHANNEL (default "dnd": the route that also reaches numbers with DND on; "generic" is cheaper but skips them).
const { HttpError } = require('../http');

/* Termii wants the international number with no "+" and no spaces: 2348012345678.
   Accepts +234 801 234 5678, 2348012345678, 08012345678, 8012345678. Returns '' when it can't be a valid number. */
function normalizePhone(input) {
  let d = String(input == null ? '' : input).replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^0\d{10}$/.test(d)) d = '234' + d.slice(1);        // 08012345678 -> 2348012345678
  else if (/^[789]\d{9}$/.test(d)) d = '234' + d;          // 8012345678  -> 2348012345678
  return /^\d{10,15}$/.test(d) ? d : '';
}

function config() {
  const apiKey = (process.env.TERMII_API_KEY || '').trim();
  const sender = (process.env.TERMII_SENDER_ID || '').trim();
  if (!apiKey || !sender) throw new HttpError(500, 'SMS is not configured (TERMII_API_KEY / TERMII_SENDER_ID).', 'sms_not_configured');
  return {
    apiKey, sender,
    base: (process.env.TERMII_BASE_URL || 'https://v4.api.termii.com').trim().replace(/\/+$/, ''),
    channel: (process.env.TERMII_CHANNEL || 'dnd').trim().toLowerCase(),
  };
}

async function sendSms(to, message) {
  const phone = normalizePhone(to);
  if (!phone) throw new HttpError(400, 'Invalid phone number.', 'bad_phone');
  const c = config();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  let r, body = {};
  try {
    r = await fetch(c.base + '/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: c.apiKey, to: phone, from: c.sender, sms: message, type: 'plain', channel: c.channel }),
      signal: ctl.signal,
    });
    body = await r.json().catch(() => ({}));
  } catch (e) {
    throw new HttpError(502, 'Could not reach the SMS provider.', 'sms_unreachable');
  } finally { clearTimeout(timer); }
  const ok = r.ok && (body.code === 'ok' || !!body.message_id);
  if (!ok) {
    console.error('Termii send failed', r.status, String(body.message || '').slice(0, 200));   // never log the key or the number
    throw new HttpError(502, 'The SMS provider rejected the message.', 'sms_failed');
  }
  return { messageId: body.message_id || null };
}

module.exports = { normalizePhone, sendSms };
