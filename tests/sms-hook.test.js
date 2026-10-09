/* Supabase "Send SMS" hook -> Termii. Termii's REST API is STUBBED (global fetch): this proves our logic
   (signature check, number formatting, request shape, error mapping), not that a real Termii account accepts the key. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { normalizePhone } = require('../api/_lib/sms/termii');
const hook = require('../api/sms-hook');

const SECRET_B64 = crypto.randomBytes(24).toString('base64');
const realFetch = global.fetch;
function env() {
  ['TERMII_API_KEY', 'TERMII_SENDER_ID', 'TERMII_BASE_URL', 'TERMII_CHANNEL', 'SEND_SMS_HOOK_SECRET', 'SMS_BRAND'].forEach(k => delete process.env[k]);
  Object.assign(process.env, { TERMII_API_KEY: 'test_key', TERMII_SENDER_ID: 'Marcato', SEND_SMS_HOOK_SECRET: 'v1,whsec_' + SECRET_B64 });
}
function signed(body, over = {}) {
  const raw = JSON.stringify(body), id = 'msg_1', ts = String(over.ts || Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', Buffer.from(SECRET_B64, 'base64')).update(`${id}.${ts}.${raw}`).digest('base64');
  return { method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': over.sig || 'v1,' + sig }, rawBody: raw };
}
function res() { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b; } }; Object.defineProperty(r, 'json', { get: () => JSON.parse(r.body) }); return r; }
const payload = { user: { id: 'u1', phone: '2348012345678' }, sms: { otp: '123456' } };

test('normalizePhone handles Nigerian formats and rejects junk', () => {
  for (const x of ['+234 801 234 5678', '2348012345678', '08012345678', '8012345678', '00234 801 234 5678']) assert.equal(normalizePhone(x), '2348012345678', x);
  for (const x of ['', null, 'abc', '123', '0801']) assert.equal(normalizePhone(x), '', String(x));
});

test('valid signed call -> one Termii request with the right shape, 200 {}', async () => {
  env(); const calls = [];
  global.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => ({ code: 'ok', message_id: 'm1', message: 'Successfully Sent' }) }; };
  try {
    const r = res(); await hook(signed(payload), r);
    assert.equal(r.statusCode, 200); assert.deepEqual(r.json, {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://v4.api.termii.com/api/sms/send');
    assert.equal(calls[0].body.to, '2348012345678'); assert.equal(calls[0].body.from, 'Marcato');
    assert.equal(calls[0].body.channel, 'dnd'); assert.equal(calls[0].body.type, 'plain'); assert.equal(calls[0].body.api_key, 'test_key');
    assert.match(calls[0].body.sms, /123456/);
  } finally { global.fetch = realFetch; }
});

test('bad / missing / stale signature -> 401 and Termii is never called', async () => {
  env(); let called = 0; global.fetch = async () => { called++; return { ok: true, json: async () => ({}) }; };
  try {
    for (const req of [signed(payload, { sig: 'v1,AAAA' }), signed(payload, { ts: Math.floor(Date.now() / 1000) - 3600 }), { method: 'POST', headers: {}, rawBody: JSON.stringify(payload) }]) {
      const r = res(); await hook(req, r); assert.equal(r.statusCode, 401); assert.equal(r.json.error.http_code, 401);
    }
    assert.equal(called, 0);
  } finally { global.fetch = realFetch; }
});

test('tampered body fails the signature', async () => {
  env(); global.fetch = async () => { throw new Error('must not be called'); };
  try { const req = signed(payload); req.rawBody = req.rawBody.replace('123456', '999999'); const r = res(); await hook(req, r); assert.equal(r.statusCode, 401); }
  finally { global.fetch = realFetch; }
});

test('Termii rejection / outage -> 502 in Supabase hook error format, key never echoed', async () => {
  env();
  try {
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ message: 'Invalid sender id' }) });
    let r = res(); await hook(signed(payload), r);
    assert.equal(r.statusCode, 502); assert.equal(r.json.error.http_code, 502); assert.ok(!r.body.includes('test_key'));
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    r = res(); await hook(signed(payload), r); assert.equal(r.statusCode, 502);
  } finally { global.fetch = realFetch; }
});

test('missing config or payload -> clear 4xx/5xx, no Termii call', async () => {
  env(); delete process.env.TERMII_API_KEY; global.fetch = async () => { throw new Error('must not be called'); };
  try {
    let r = res(); await hook(signed(payload), r); assert.equal(r.statusCode, 500);
    env(); r = res(); await hook(signed({ user: {}, sms: {} }), r); assert.equal(r.statusCode, 400);
    r = res(); await hook({ method: 'GET', headers: {} }, r); assert.equal(r.statusCode, 405);
  } finally { global.fetch = realFetch; }
});
