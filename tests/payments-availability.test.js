/* Paystack availability + start-payment failure handling, server side. Paystack's REST API is STUBBED here (global fetch):
   this proves our logic, not that a real Paystack account accepts the key. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const KEYS = ['PAYMENT_PROVIDER', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_PUBLIC_KEY', 'ALLOW_MOCK_PAYMENTS', 'MOCK_WEBHOOK_SECRET', 'VERCEL_ENV', 'SITE_URL'];
function env(vars) { KEYS.forEach(k => delete process.env[k]); Object.assign(process.env, vars || {}); }
const lib = f => path.join(__dirname, '..', 'api', '_lib', f);
function fresh(rel, stubs) {
  Object.keys(require.cache).forEach(k => { if (k.includes(path.join('api', '_lib'))) delete require.cache[k]; });
  for (const [f, exp] of Object.entries(stubs || {})) { const p = require.resolve(lib(f)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
  return require(lib(rel));
}
function res() { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b; } }; Object.defineProperty(r, 'json', { get: () => JSON.parse(r.body) }); return r; }
const fakeDb = () => ({ from: () => ({ select: () => ({ in: async () => ({ data: [] }) }), update: () => ({ eq: async () => ({}) }) }) });

test('provider selection: every env combination gives the right answer and reason', () => {
  const cases = [
    [{}, null, 'provider_not_selected'],
    [{ PAYSTACK_SECRET_KEY: 'sk_test_abc' }, 'paystack', null],                       // key present, PAYMENT_PROVIDER forgotten -> still works
    [{ PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_test_abc' }, 'paystack', null],
    [{ PAYMENT_PROVIDER: 'paystack' }, null, 'missing_credentials'],
    [{ PAYMENT_PROVIDER: 'PayStack ', PAYSTACK_SECRET_KEY: 'sk_live_abc' }, 'paystack', null],
    [{ PAYMENT_PROVIDER: 'flutterwave', PAYSTACK_SECRET_KEY: 'sk_test_abc' }, null, 'unknown_provider'],   // an explicit choice is never overridden
    [{ PAYMENT_PROVIDER: 'mock', ALLOW_MOCK_PAYMENTS: 'true' }, null, 'missing_credentials'],
    [{ PAYSTACK_SECRET_KEY: '   ' }, null, 'provider_not_selected']
  ];
  for (const [vars, want, reason] of cases) {
    env(vars); const p = fresh('payments/index');
    const a = p.active();
    assert.equal(a ? a.id : null, want, JSON.stringify(vars));
    assert.equal(p.inactiveReason(), reason, JSON.stringify(vars));
  }
  env({ PAYSTACK_SECRET_KEY: 'sk_test_abc' });
  assert.equal(fresh('payments/index').status().inferred, true);
  assert.deepEqual(fresh('payments/index').status().missing, ['PAYSTACK_PUBLIC_KEY'], 'admin screen still tells you the public key is missing');
  assert.equal(fresh('payments/index').active().isTest, true);
  env();
});

test('GET /api/payment-methods: configured with a Paystack key, and never leaks a key', async () => {
  env({ PAYSTACK_SECRET_KEY: 'sk_test_SECRETVALUE', PAYSTACK_PUBLIC_KEY: 'pk_test_PUBLIC' });
  const route = fresh('routes/payment-methods', { 'db': { db: fakeDb() } });
  const r = res(); await route({ method: 'GET', headers: {} }, r);
  assert.equal(r.json.configured, true); assert.equal(r.json.provider, 'paystack'); assert.equal(r.json.is_test, true);
  assert.ok(r.json.methods.length >= 1);
  assert.doesNotMatch(r.body, /SECRETVALUE|sk_test/);
  env();
  const off = fresh('routes/payment-methods', { 'db': { db: fakeDb() } });
  const r2 = res(); const warn = console.warn; let logged = ''; console.warn = m => { logged += m; };
  await off({ method: 'GET', headers: {} }, r2); console.warn = warn;
  assert.equal(r2.json.configured, false); assert.equal(r2.json.reason, 'provider_not_selected');
  assert.match(logged, /not available: provider_not_selected \(missing: PAYMENT_PROVIDER\)/, 'the exact missing variable is written to the server log');
});

function checkoutHarness(paystackReply) {
  const rpcCalls = [];
  const rpc = async (name, args) => {
    rpcCalls.push([name, args]);
    if (name === 'create_checkout') return { order_id: 55, amount: 5000, currency: 'NGN', subtotal: 5000, delivery_fee: 0, service_fee: 0, tax: 0 };
    return {};
  };
  const paystackCalls = [];
  global.fetch = async (url, init) => {
    paystackCalls.push({ url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
    const r = paystackReply;
    return { ok: r.ok, status: r.status, json: async () => r.json };
  };
  const route = fresh('routes/checkout', { 'db': { db: fakeDb, rpc }, 'auth': { optionalUser: async () => null } });
  return { route, rpcCalls, paystackCalls };
}
const REQ = () => ({ method: 'POST', headers: { host: 'shop.test' }, body: { items: [{ product_id: 1, qty: 1 }], method: 'card', delivery: { name: 'A', phone: '1', email: 'a@b.co', line1: 'x', state: 'Lagos', lga: 'Ikeja' } } });

test('POST /api/checkout: initialises Paystack with the server-side key and returns what the popup needs', async () => {
  env({ PAYSTACK_SECRET_KEY: 'sk_test_SECRETVALUE', PAYSTACK_PUBLIC_KEY: 'pk_test_PUBLIC' });
  const h = checkoutHarness({ ok: true, status: 200, json: { status: true, data: { authorization_url: 'https://checkout.paystack.com/AC', access_code: 'AC', reference: 'ref' } } });
  const r = res(); await h.route(REQ(), r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json.access_code, 'AC'); assert.equal(r.json.public_key, 'pk_test_PUBLIC'); assert.equal(r.json.order_id, 55);
  assert.doesNotMatch(r.body, /sk_test|SECRETVALUE/, 'secret key never sent to the browser');
  assert.equal(h.paystackCalls[0].url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(h.paystackCalls[0].auth, 'Bearer sk_test_SECRETVALUE');
  assert.equal(h.paystackCalls[0].body.amount, 500000, 'naira -> kobo');
  assert.deepEqual(h.paystackCalls[0].body.channels, ['card']);
  assert.ok(!h.rpcCalls.some(c => c[0] === 'finalize_payment'), 'initialising a payment never marks anything paid');
  env();
});

test('POST /api/checkout: a Paystack rejection (e.g. wrong key) returns a safe error WITH the order id, logs the real cause, and marks nothing paid', async () => {
  env({ PAYSTACK_SECRET_KEY: 'sk_test_SECRETVALUE' });
  const h = checkoutHarness({ ok: false, status: 401, json: { status: false, message: 'Invalid key' } });
  const r = res(); const err = console.error; let logged = ''; console.error = m => { logged += m; };
  await h.route(REQ(), r); console.error = err;
  assert.equal(r.statusCode, 502); assert.equal(r.json.code, 'provider_error'); assert.equal(r.json.order_id, 55, 'order id returned so the page retries the same order');
  assert.ok(r.json.guest_token, 'guest token returned so the retry is authorised');
  assert.doesNotMatch(r.body, /Invalid key|sk_test|SECRETVALUE/, 'no provider internals or keys in the customer response');
  assert.match(logged, /initialize failed for order 55: HTTP 401 Invalid key/, 'the real cause is in the server log');
  assert.ok(h.rpcCalls.some(c => c[0] === 'fail_payment'), 'the attempt is recorded as failed');
  assert.ok(!h.rpcCalls.some(c => c[0] === 'finalize_payment'));
  env();
});

test('POST /api/checkout: 503 payments_not_configured when nothing is configured (and no order is created)', async () => {
  env();
  const h = checkoutHarness({ ok: true, status: 200, json: {} });
  const r = res(); const err = console.error; console.error = () => {}; await h.route(REQ(), r); console.error = err;
  assert.equal(r.statusCode, 503); assert.equal(r.json.code, 'payments_not_configured');
  assert.equal(h.rpcCalls.length, 0);
});

test('POST /api/payment-verify only finalises after the provider itself says success', async () => {
  env({ PAYSTACK_SECRET_KEY: 'sk_test_SECRETVALUE' });
  const rpcCalls = [];
  const payRow = { reference: 'MCT-1', provider: 'paystack', status: 'pending', order_id: 55, currency: 'NGN' };
  const stubDb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: payRow, error: null }) }) }) }) };
  const rpc = async (n, a) => { rpcCalls.push(n); return n === 'finalize_payment' ? { status: 'processed', payment_status: 'paid', vendor_ids: [] } : { payment_status: 'failed' }; };
  for (const [paystackStatus, expectFinalize] of [['abandoned', false], ['failed', false], ['success', true]]) {
    rpcCalls.length = 0;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ status: true, data: { status: paystackStatus, amount: 500000, currency: 'NGN', id: 9, channel: 'card' } }) });
    const route = fresh('routes/payment-verify', { 'db': { db: () => stubDb, rpc } });
    const r = res(); await route({ method: 'POST', headers: {}, body: { reference: 'MCT-1' } }, r);
    assert.equal(rpcCalls.includes('finalize_payment'), expectFinalize, 'paystack status ' + paystackStatus);
    if (!expectFinalize) assert.notEqual(r.json.payment_status, 'paid');
  }
  env();
});
