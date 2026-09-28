/* Checkout: (1) typed fields survive state / LGA / payment-method changes and section navigation,
   (2) saved details load and persist without duplicates, (3) payment start is single-flight, reuses the order after a
   failure, keeps the cart, and never treats a popup callback as "paid" (only /api/payment-verify decides).
   CHECKOUT_FILE=<path> runs the same tests against another copy of checkout-page.js (used to prove the old code fails). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const CHECKOUT = process.env.CHECKOUT_FILE || path.join(ROOT, 'components', 'checkout-page.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

function fakeSb(seed) {
  const clone = a => JSON.parse(JSON.stringify(a || []));
  const db = { profiles: clone(seed.profiles), addresses: clone(seed.addresses) }, log = [];
  let nextId = 100;
  function from(table) {
    let rows = db[table], st = {};
    const q = {
      select() { return q; }, order() { return q; },
      eq(c, v) { st.eq = st.eq || []; st.eq.push([c, v]); return q; }, neq(c, v) { st.neq = [c, v]; return q; },
      maybeSingle() { st.one = true; return q; }, single() { st.one = true; return q; },
      upsert(arr) { st.upsert = arr; return q; }, insert(arr) { st.ins = arr; return q; }, update(o) { st.upd = o; return q; },
      then(res, rej) {
        let out;
        const match = r => (st.eq || []).every(([c, v]) => r[c] === v) && (!st.neq || r[st.neq[0]] !== st.neq[1]);
        if (st.ins) { const row = Object.assign({ id: nextId++ }, st.ins[0]); db[table].push(row); log.push(['insert', table, row]); out = { data: st.one ? row : [row], error: null }; }
        else if (st.upsert) { const row = Object.assign({}, st.upsert[0]); db[table] = db[table].filter(r => r.user_id !== row.user_id).concat(row); log.push(['upsert', table, row]); out = { data: row, error: null }; }
        else if (st.upd) { const hit = db[table].filter(match); hit.forEach(r => Object.assign(r, st.upd)); log.push(['update', table, st.upd, st.eq]); out = { data: st.one ? (hit[0] || null) : hit, error: null }; }
        else { const hit = db[table].filter(match); out = { data: st.one ? (hit[0] || null) : hit, error: null }; }
        return Promise.resolve(out).then(res, rej);
      }
    };
    return q;
  }
  return { from, db, log };
}

async function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><body><div id="chkPage"></div></body>', { url: 'https://shop.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, calls = [];
  ['data/buyer.js', 'data/nigeria-addresses.js'].forEach(f => w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  w.Pcx = { AddressSearch: { mount(el, o) { w.__pick = o.onPick; return {}; } } };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.eval(fs.readFileSync(CHECKOUT, 'utf8'));
  const responses = opts.responses || {};
  w.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    const r = responses[url.split('?')[0]];
    const out = typeof r === 'function' ? await r(body, calls) : r;
    const res = out || { status: 404, json: {} };
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.json };
  };
  const sb = fakeSb(opts.seed || {});
  const cart = opts.cart || [{ id: 7, name: 'Shoe', price: 5000, qty: 1, vendor_id: null }];
  let paid = 0, toasts = [];
  w.Pcx.Checkout.init({ sb, session: () => opts.session || null, cart: () => cart, sellerName: () => 'S', fmt: n => 'N' + n, toast: m => toasts.push(m), onPaid: () => { paid++; cart.length = 0; }, onExit() {}, openOrders() {} });
  return { w, sb, calls, cart, toasts, paid: () => paid, $: s => w.document.querySelector(s), $$: s => [...w.document.querySelectorAll(s)] };
}
const METHODS = { status: 200, json: { configured: true, provider: 'paystack', is_test: true, methods: [{ id: 'card', label: 'Card' }, { id: 'bank_transfer', label: 'Bank transfer' }], pricing: { delivery_fee: 0, service_fee: 0, tax_rate: 0 } } };

function setVal(t, key, v, fire) { const el = t.$(`[data-f="${key}"]`); el.value = v; if (fire) el.dispatchEvent(new t.w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return el; }
const vals = t => Object.fromEntries(t.$$('[data-f]').map(e => [e.dataset.f, e.value]));

for (const fire of [true, false]) {
  test(`checkout form: nothing typed is lost when state / LGA / payment method / Change are used (events ${fire ? 'fired' : 'NOT fired, e.g. autofill'})`, async () => {
    const t = await boot({ responses: { '/api/payment-methods': METHODS } });
    await t.w.Pcx.Checkout.open(); await wait(20);
    setVal(t, 'name', 'Ada Obi', fire); setVal(t, 'phone', '08031234567', fire); setVal(t, 'email', 'ada@example.com', fire);
    setVal(t, 'line1', '12 Admiralty Way', fire); setVal(t, 'city', 'Lekki', fire); setVal(t, 'landmark', 'Near the mall', fire);
    setVal(t, 'house_number', 'Flat 4', fire); setVal(t, 'delivery_instructions', 'Call at the gate', fire);
    const before = vals(t);

    // choose a state
    setVal(t, 'state', 'Lagos', true);
    let after = vals(t);
    for (const k of ['name', 'phone', 'email', 'line1', 'city', 'landmark', 'house_number', 'delivery_instructions']) assert.equal(after[k], before[k], `${k} survives choosing a state`);
    assert.equal(after.state, 'Lagos');
    const lagosLgas = t.$$('[data-f="lga"] option').map(o => o.value);
    assert.ok(lagosLgas.includes('Eti-Osa') && lagosLgas.includes('Ikeja'), 'LGA list is the Lagos list');

    // choose an LGA
    setVal(t, 'lga', 'Eti-Osa', true);
    assert.equal(vals(t).lga, 'Eti-Osa');
    assert.equal(vals(t).line1, '12 Admiralty Way');

    // a full re-render (payment method click) must not wipe the form either
    t.$('[data-a="method"][data-id="bank_transfer"]').click();
    after = vals(t);
    for (const k of ['name', 'phone', 'email', 'line1', 'city', 'landmark', 'house_number', 'delivery_instructions', 'state', 'lga']) assert.equal(after[k], k === 'state' ? 'Lagos' : k === 'lga' ? 'Eti-Osa' : before[k], `${k} survives a payment-method re-render`);

    // switching state clears only the LGA (it no longer belongs), nothing else
    setVal(t, 'state', 'Oyo', true);
    after = vals(t);
    assert.equal(after.lga, '', 'LGA is cleared because it does not belong to the new state');
    assert.ok(t.$$('[data-f="lga"] option').some(o => o.value === 'Ibadan North'), 'LGA list now shows the Oyo LGAs');
    for (const k of ['name', 'phone', 'email', 'line1', 'city', 'landmark', 'house_number', 'delivery_instructions']) assert.equal(after[k], before[k], `${k} survives switching state`);

    // use the address, then Change: the form is still filled in
    setVal(t, 'lga', 'Ibadan North', true);
    t.$('[data-a="save-address"]').click();
    assert.ok(!t.$('[data-f="line1"]'), 'address summary shown');
    t.$('[data-a="edit"]').click();
    after = vals(t);
    assert.equal(after.line1, '12 Admiralty Way'); assert.equal(after.state, 'Oyo'); assert.equal(after.lga, 'Ibadan North'); assert.equal(after.name, 'Ada Obi');

    // an invalid submit (missing phone) toasts and keeps everything
    setVal(t, 'phone', '', true);
    t.$('[data-a="save-address"]').click();
    assert.match(t.toasts.at(-1), /name, phone/i);
    assert.equal(vals(t).line1, '12 Admiralty Way', 'fields intact after a validation error');
    t.w.close();
  });
}

test('checkout form: the address search fills street/city/state without wiping other fields and maps "Lagos State" to the dropdown', async () => {
  const t = await boot({ responses: { '/api/payment-methods': METHODS } });
  await t.w.Pcx.Checkout.open(); await wait(20);
  setVal(t, 'name', 'Ada Obi', false); setVal(t, 'phone', '0803', false); setVal(t, 'landmark', 'Blue gate', false);
  t.w.__pick({ line1: '5 Broad St', city: 'Marina', state: 'Lagos State', lat: 6.45, lon: 3.39, display_name: '5 Broad St, Lagos' });
  const v = vals(t);
  assert.equal(v.name, 'Ada Obi'); assert.equal(v.phone, '0803'); assert.equal(v.landmark, 'Blue gate');
  assert.equal(v.line1, '5 Broad St'); assert.equal(v.state, 'Lagos', '"Lagos State" is mapped to the option "Lagos"');
  t.w.close();
});

const USER = { user: { id: 'u1', email: 'ada@example.com' }, access_token: 'tok' };
const SAVED = { id: 5, user_id: 'u1', label: 'Home', full_name: 'Ada Obi', phone: '0803', line1: '1 Old Rd', city: 'Yaba', state: 'Lagos', lga: 'Lagos Mainland', is_default: true, created_at: 'x' };
const PAY_OK = { status: 200, json: { order_id: 900, reference: 'MCT-1', provider: 'paystack', access_code: 'AC_1', public_key: 'pk_test_x', authorization_url: 'https://checkout.paystack.com/AC_1', guest_token: null } };

test('saved details: a signed-in buyer\'s default address is loaded, and reused without asking again', async () => {
  const t = await boot({ session: USER, seed: { addresses: [SAVED], profiles: [{ user_id: 'u1', full_name: 'Ada Obi', phone: '0803' }] }, responses: { '/api/payment-methods': METHODS } });
  await t.w.Pcx.Checkout.open(); await wait(30);
  assert.match(t.$('.ck-addr2').textContent, /1 Old Rd/, 'saved address shown as the delivery address');
  assert.equal(t.$('.ck-pay').disabled, false, 'can pay straight away: nobody is asked to retype');
  t.w.close();
});

test('saved details: a new address is inserted ONCE; editing a saved one UPDATES it and keeps the default flag', async () => {
  const t = await boot({ session: USER, seed: { addresses: [SAVED], profiles: [{ user_id: 'u1', full_name: 'Ada Obi', phone: '0803' }] },
    responses: { '/api/payment-methods': METHODS, '/api/checkout': PAY_OK } });
  t.w.PaystackPop = function () { this.resumeTransaction = () => {}; };
  await t.w.Pcx.Checkout.open(); await wait(30);
  // edit the saved address
  t.$('[data-a="edit"]').click();
  setVal(t, 'line1', '2 New Rd', true);
  t.$('[data-a="save-address"]').click();
  t.$('.ck-pay').click(); await wait(40);
  const writes = t.sb.log.filter(l => l[1] === 'insert' || (l[0] === 'update' && l[2] && l[2].line1));
  assert.equal(writes.filter(l => l[0] === 'insert' && l[1] === 'addresses').length, 0, 'editing did not create a second address');
  const upd = writes.find(l => l[0] === 'update'); assert.ok(upd, 'the saved address was updated'); assert.equal(upd[2].line1, '2 New Rd'); assert.equal(upd[2].is_default, true, 'default flag kept');
  assert.equal(t.sb.db.addresses.length, 1);

  // brand-new address (form opened fresh via a second buyer with none saved) inserts exactly once even if pay is pressed twice
  const t2 = await boot({ session: USER, responses: { '/api/payment-methods': METHODS, '/api/checkout': PAY_OK } });
  t2.w.PaystackPop = function () { this.resumeTransaction = () => {}; };
  await t2.w.Pcx.Checkout.open(); await wait(30);
  setVal(t2, 'name', 'Ada Obi', true); setVal(t2, 'phone', '0803', true); setVal(t2, 'line1', '9 Fresh St', true); setVal(t2, 'state', 'Lagos', true);
  t2.$('[data-a="save-address"]').click();
  t2.$('.ck-pay').click(); t2.$('.ck-pay').click(); await wait(60);
  assert.equal(t2.sb.db.addresses.length, 1, 'inserted once');
  assert.equal(t2.sb.db.addresses[0].is_default, true, 'first address becomes the default');
  assert.equal(t2.calls.filter(c => c.url === '/api/checkout').length, 1, 'double tap started one payment only');
  t.w.close(); t2.w.close();
});

test('guest: details are remembered on this device', async () => {
  const t = await boot({ responses: { '/api/payment-methods': METHODS, '/api/checkout': PAY_OK } });
  t.w.PaystackPop = function () { this.resumeTransaction = () => {}; };
  await t.w.Pcx.Checkout.open(); await wait(20);
  setVal(t, 'name', 'Guest G', true); setVal(t, 'phone', '0801', true); setVal(t, 'email', 'g@example.com', true); setVal(t, 'line1', '3 Guest Ave', true);
  t.$('[data-a="save-address"]').click(); t.$('.ck-pay').click(); await wait(40);
  assert.equal(JSON.parse(t.w.localStorage.getItem('mct_delivery_v1')).line1, '3 Guest Ave');
  t.w.close();
});

test('payment: a failed start keeps the cart and details, and the retry reuses the SAME order (no duplicate order)', async () => {
  let n = 0;
  const t = await boot({ session: USER, seed: { addresses: [SAVED] }, responses: {
    '/api/payment-methods': METHODS,
    '/api/checkout': (body) => (++n === 1 ? { status: 502, json: { error: 'We could not start the payment. Please try again.', code: 'provider_error', order_id: 901, guest_token: null } } : PAY_OK)
  } });
  const popup = { resumed: null }; t.w.PaystackPop = function () { this.resumeTransaction = (code) => { popup.resumed = code; }; };
  await t.w.Pcx.Checkout.open(); await wait(30);
  t.$('.ck-pay').click(); await wait(40);
  assert.match(t.$('.ck-body').textContent, /could not start the payment/i, 'the failure is shown, not hidden');
  assert.equal(t.cart.length, 1, 'cart untouched'); assert.equal(t.paid(), 0);
  assert.match(t.$('.ck-addr2').textContent, /1 Old Rd/, 'delivery details still there');
  assert.equal(t.$('.ck-pay').disabled, false, 'can try again');
  t.$('.ck-pay').click(); await wait(40);
  const checkoutCalls = t.calls.filter(c => c.url === '/api/checkout');
  assert.ok(checkoutCalls[0].body.items, 'first call creates the order');
  assert.equal(checkoutCalls[1].body.order_id, 901, 'second call retries order 901');
  assert.equal(checkoutCalls[1].body.items, undefined, 'and does not send the cart again (which would create a second order)');
  assert.equal(popup.resumed, 'AC_1', 'the Paystack popup opens inside Marcato');
  t.w.close();
});

test('payment: an EDITED cart after a failure creates a fresh order (the old one no longer matches)', async () => {
  let n = 0;
  const t = await boot({ session: USER, seed: { addresses: [SAVED] }, responses: { '/api/payment-methods': METHODS,
    '/api/checkout': () => (++n === 1 ? { status: 502, json: { error: 'x', order_id: 901 } } : PAY_OK) } });
  t.w.PaystackPop = function () { this.resumeTransaction = () => {}; };
  await t.w.Pcx.Checkout.open(); await wait(30);
  t.$('.ck-pay').click(); await wait(30);
  t.cart[0].qty = 3;
  t.$('.ck-pay').click(); await wait(30);
  assert.ok(t.calls.filter(c => c.url === '/api/checkout')[1].body.items, 'quantity changed -> new order');
  t.w.close();
});

test('payment: the popup callback alone never marks an order paid; only /api/payment-verify does', async () => {
  let verify = { status: 200, json: { payment_status: 'pending', order_id: 900 } };
  const t = await boot({ session: USER, seed: { addresses: [SAVED] }, responses: { '/api/payment-methods': METHODS, '/api/checkout': PAY_OK,
    '/api/payment-verify': () => verify, '/api/order-status': { status: 200, json: { order: { id: 900, total: 5000 }, sellers: [] } } } });
  let cbs; t.w.PaystackPop = function () { this.resumeTransaction = (code, c) => { cbs = c; }; };
  await t.w.Pcx.Checkout.open(); await wait(30);
  t.$('.ck-pay').click(); await wait(40);
  cbs.onSuccess({ reference: 'MCT-1' }); await wait(40);
  assert.equal(t.paid(), 0, 'provider says pending -> cart NOT cleared, order NOT paid');
  assert.match(t.w.document.getElementById('payResult').textContent, /Confirming your payment/);
  verify = { status: 200, json: { payment_status: 'paid', order_id: 900 } };
  cbs.onSuccess({ reference: 'MCT-1' }); await wait(60);
  assert.equal(t.paid(), 1, 'verified paid -> cart cleared');
  assert.ok(t.calls.some(c => c.url === '/api/payment-verify' && c.body.reference === 'MCT-1'));
  t.w.close();
});

test('payment: cancelling the popup keeps everything and lets the customer retry', async () => {
  const t = await boot({ session: USER, seed: { addresses: [SAVED] }, responses: { '/api/payment-methods': METHODS, '/api/checkout': PAY_OK } });
  let cbs; t.w.PaystackPop = function () { this.resumeTransaction = (c, o) => { cbs = o; }; };
  await t.w.Pcx.Checkout.open(); await wait(30);
  t.$('.ck-pay').click(); await wait(40);
  cbs.onCancel(); await wait(10);
  assert.equal(t.$('.ck-pay').disabled, false); assert.equal(t.cart.length, 1); assert.equal(t.paid(), 0);
  t.w.close();
});

test('payment availability: the "not available" notice is only for a genuinely unconfigured server; an unreachable endpoint gets an accurate message + retry', async () => {
  const un = await boot({ responses: { '/api/payment-methods': { status: 200, json: { configured: false, reason: 'provider_not_selected', methods: [] } } } });
  await un.w.Pcx.Checkout.open(); await wait(20);
  assert.match(un.$('.ck-body').textContent, /Online payment is not available yet/);
  un.w.close();
  let n = 0;
  const bad = await boot({ responses: { '/api/payment-methods': () => (++n === 1 ? { status: 500, json: { error: 'boom' } } : METHODS) } });
  await bad.w.Pcx.Checkout.open(); await wait(20);
  assert.doesNotMatch(bad.$('.ck-body').textContent, /not available yet/);
  assert.match(bad.$('.ck-body').textContent, /could not reach the payment service/i);
  bad.$('[data-a="retry-methods"]').click(); await wait(30);
  assert.match(bad.$('.ck-body').textContent, /Payment method/, 'retry recovers');
  bad.w.close();
});
