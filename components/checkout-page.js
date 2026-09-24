/* Pcx.Checkout: the full-screen checkout page and the payment result page.
 *
 *   Pcx.Checkout.init({ sb, session: () => buyerSession, cart: () => cart, sellerName: id => 'Store name', fmt, toast,
 *                       onPaid: () => { clear the cart }, onExit: () => {}, openOrders: () => {} });
 *   Pcx.Checkout.open();                 // from the cart's "Proceed to checkout"
 *   Pcx.Checkout.handleReturn();         // on page load: finishes ?pay_return=1 after the payment page
 *
 * What it does
 *  - reuses saved details: a signed-in buyer's profile + default address (guests: this device), so nobody is asked twice
 *  - groups the cart by seller: one checkout, one payment, several sellers
 *  - shows the payment methods the configured provider offers (/api/payment-methods), never a hard-coded gateway
 *  - sends only product ids and quantities to /api/checkout: prices, stock, fees and commission are decided on the server
 *  - never decides a payment succeeded: the result page asks /api/payment-verify, which asks the provider
 * Needs: data/buyer.js, components/address-search.js
 */
(function (global) {
  'use strict';

  var D = null;                       // injected dependencies
  var root = null;
  var S = null;                       // page state
  var PENDING_KEY = 'mct_pending_v1';

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ICON = {
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    pin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
    card: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    bank: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-6 9 6"/><line x1="5" y1="10" x2="5" y2="18"/><line x1="10" y1="10" x2="10" y2="18"/><line x1="14" y1="10" x2="14" y2="18"/><line x1="19" y1="10" x2="19" y2="18"/><line x1="3" y1="21" x2="21" y2="21"/></svg>',
    phone: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>',
    check: '<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"/></svg>',
    cross: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    clock: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>'
  };
  var METHOD_ICON = { card: 'card', bank_transfer: 'bank', bank: 'bank', ussd: 'phone', qr: 'phone', mobile_money: 'phone' };

  /* ── data ── */

  function token() { var s = D.session(); return s && s.access_token; }

  function cartGroups() {
    var groups = {}, order = [];
    D.cart().forEach(function (it) {
      var k = it.vendor_id || 'store';
      if (!groups[k]) { groups[k] = { id: k, name: k === 'store' ? 'Maccato' : D.sellerName(k), items: [], subtotal: 0 }; order.push(k); }
      groups[k].items.push(it); groups[k].subtotal += it.price * it.qty;
    });
    return order.map(function (k) { return groups[k]; });
  }

  function totals() {
    var sub = D.cart().reduce(function (s, x) { return s + x.price * x.qty; }, 0);
    var p = S.pricing || { delivery_fee: 0, service_fee: 0, tax_rate: 0 };
    var tax = Math.round(sub * p.tax_rate) / 100;
    return { subtotal: sub, delivery: p.delivery_fee, service: p.service_fee, tax: tax, total: sub + p.delivery_fee + p.service_fee + tax };
  }

  async function loadSaved() {
    var s = D.session();
    if (s) {
      var uid = s.user.id;
      var res = await Promise.all([Buyer.profile(D.sb, uid), Buyer.addresses(D.sb, uid)]);
      S.profile = res[0]; S.addresses = res[1];
      var def = S.addresses.find(function (a) { return a.is_default; }) || S.addresses[0] || null;
      var d = Buyer.fromSaved(S.profile, def, s.user.email);
      S.delivery = d.line1 ? d : null;
      S.form = Object.assign({ name: d.name, phone: d.phone, email: s.user.email }, S.delivery || {});
    } else {
      var g = Buyer.guest();
      S.delivery = g && Buyer.complete(g) ? g : null;
      S.form = Object.assign({ name: '', phone: '', email: '', line1: '', city: '', state: '' }, g || {});
      S.addresses = [];
    }
    S.editing = !Buyer.complete(S.delivery);
  }

  async function loadMethods() {
    try {
      var j = await (await fetch('/api/payment-methods')).json();
      S.configured = !!j.configured; S.methods = j.methods || []; S.isTest = !!j.is_test; S.pricing = j.pricing || S.pricing;
      if (!S.method || !S.methods.some(function (m) { return m.id === S.method; })) S.method = S.methods.length ? S.methods[0].id : null;
    } catch (_) { S.configured = false; S.methods = []; }
  }

  /* ── rendering ── */

  function renderDelivery() {
    var s = D.session();
    if (!S.editing && S.delivery) {
      var d = S.delivery;
      return '<section class="ck-card"><div class="ck-h"><span>' + ICON.pin + 'Delivery address</span><button class="ck-link" data-a="edit">Change</button></div>' +
        '<div class="ck-addr"><b>' + esc(d.name) + '</b> <span class="ck-dot">&middot;</span> ' + esc(d.phone) + '</div>' +
        '<div class="ck-addr2">' + esc([d.line1, d.city, d.state].filter(Boolean).join(', ')) + '</div>' +
        '<div class="ck-mute">' + esc(d.email) + '</div></section>';
    }
    var f = S.form || {};
    var saved = S.addresses && S.addresses.length ? '<div class="ck-saved"><div class="ck-sub">Your saved addresses</div>' + S.addresses.map(function (a) {
      return '<button class="ck-saved__item" data-a="use-addr" data-id="' + a.id + '"><b>' + esc(a.label) + (a.is_default ? ' <em>Default</em>' : '') + '</b><span>' + esc([a.line1, a.city, a.state].filter(Boolean).join(', ')) + '</span></button>';
    }).join('') + '<div class="ck-sub" style="margin-top:14px">Or use a new address</div></div>' : '';
    return '<section class="ck-card"><div class="ck-h"><span>' + ICON.pin + 'Delivery address</span>' + (S.delivery ? '<button class="ck-link" data-a="cancel-edit">Cancel</button>' : '') + '</div>' + saved +
      '<div class="ck-grid"><label class="ck-f"><span>Full name</span><input data-f="name" autocomplete="name" value="' + esc(f.name) + '"></label>' +
      '<label class="ck-f"><span>Phone number</span><input data-f="phone" type="tel" autocomplete="tel" value="' + esc(f.phone) + '"></label></div>' +
      (s ? '' : '<label class="ck-f"><span>Email (for your receipt)</span><input data-f="email" type="email" autocomplete="email" value="' + esc(f.email) + '"></label>') +
      '<div class="ck-sub">Find your address</div><div data-as></div>' +
      '<div class="ck-sub">Or type it in</div>' +
      '<label class="ck-f"><span>Street address</span><input data-f="line1" autocomplete="street-address" value="' + esc(f.line1) + '"></label>' +
      '<div class="ck-grid"><label class="ck-f"><span>City / area</span><input data-f="city" value="' + esc(f.city) + '"></label>' +
      '<label class="ck-f"><span>State</span><input data-f="state" value="' + esc(f.state) + '"></label></div>' +
      '<label class="ck-check"><input type="checkbox" data-a="save-flag"' + (S.saveFlag ? ' checked' : '') + '><span>' + (s ? 'Save to my address book so I am not asked again' : 'Remember these details on this device') + '</span></label>' +
      '<button class="ck-btn ck-btn--dark" data-a="save-address">Use this address</button></section>';
  }

  function renderItems() {
    var groups = cartGroups();
    var note = groups.length > 1
      ? '<div class="ck-note">Your order has items from <b>' + groups.length + ' sellers</b>. You pay once, and each seller ships their own items.</div>' : '';
    return '<section class="ck-card"><div class="ck-h"><span>Your order</span><span class="ck-mute">' + D.cart().length + ' item' + (D.cart().length === 1 ? '' : 's') + '</span></div>' + note +
      groups.map(function (g) {
        return '<div class="ck-seller"><div class="ck-seller__h">Sold by <b>' + esc(g.name) + '</b></div>' + g.items.map(function (it) {
          return '<div class="ck-item"><div class="ck-item__img">' + (it.image_url ? '<img src="' + esc(it.image_url) + '" alt="">' : '') + '</div>' +
            '<div class="ck-item__b"><div class="ck-item__n">' + esc(it.name) + '</div><div class="ck-mute">Qty ' + it.qty + ' &times; ' + D.fmt(it.price) + '</div></div>' +
            '<div class="ck-item__p">' + D.fmt(it.price * it.qty) + '</div></div>';
        }).join('') + (groups.length > 1 ? '<div class="ck-seller__t"><span>Seller subtotal</span><b>' + D.fmt(g.subtotal) + '</b></div>' : '') + '</div>';
      }).join('') + '</section>';
  }

  function renderPayment() {
    if (!S.configured) {
      return '<section class="ck-card"><div class="ck-h"><span>Payment</span></div><div class="ck-warn"><b>Online payment is not available yet.</b> Your cart is saved. Please check back soon.</div></section>';
    }
    return '<section class="ck-card"><div class="ck-h"><span>Payment method</span><span class="ck-mute">' + ICON.lock + ' Secure</span></div>' +
      (S.isTest ? '<div class="ck-test"><b>TEST MODE</b> This is a test payment. No real money moves.</div>' : '') +
      S.methods.map(function (m) {
        var on = S.method === m.id;
        return '<button class="ck-method' + (on ? ' is-on' : '') + '" data-a="method" data-id="' + esc(m.id) + '"><span class="ck-method__i">' + ICON[METHOD_ICON[m.id] || 'card'] + '</span>' +
          '<span class="ck-method__t"><b>' + esc(m.label) + '</b><em>' + esc(m.hint || '') + '</em></span><span class="ck-radio"></span></button>';
      }).join('') + '<div class="ck-mute" style="margin-top:8px">You will finish paying on the payment provider\'s secure page.</div></section>';
  }

  function renderSummary() {
    var t = totals();
    var row = function (l, v, cls) { return '<div class="ck-row' + (cls ? ' ' + cls : '') + '"><span>' + l + '</span><span>' + v + '</span></div>'; };
    return '<section class="ck-card"><div class="ck-h"><span>Order summary</span></div>' +
      row('Items', D.fmt(t.subtotal)) + row('Delivery', t.delivery ? D.fmt(t.delivery) : 'Free') +
      (t.service ? row('Service fee', D.fmt(t.service)) : '') + (t.tax ? row('Tax', D.fmt(t.tax)) : '') +
      row('Total', D.fmt(t.total), 'ck-row--total') + '</section>';
  }

  function render() {
    if (!root) return;
    var t = totals();
    var ready = !S.editing && Buyer.complete(S.delivery) && S.configured && S.method && D.cart().length && !S.busy;
    root.innerHTML =
      '<header class="ck-hdr"><button class="ck-back" data-a="back" aria-label="Back">' + ICON.back + '</button><h2>Checkout</h2><span class="ck-secure">' + ICON.lock + ' Secure</span></header>' +
      '<div class="ck-body">' +
        (S.loading ? '<div class="ck-load">Loading your details...</div>' :
          renderDelivery() + renderItems() + renderPayment() + renderSummary() +
          (S.error ? '<div class="ck-warn">' + esc(S.error) + '</div>' : '') +
          '<div class="ck-fine">By paying you agree to Maccato\'s terms. Each seller is responsible for their own products.</div>') +
      '</div>' +
      '<footer class="ck-bar"><div class="ck-bar__t"><span>Total</span><b>' + D.fmt(t.total) + '</b></div>' +
        '<button class="ck-pay" data-a="pay"' + (ready ? '' : ' disabled') + '>' + (S.busy ? 'Starting payment...' : 'Pay ' + D.fmt(t.total)) + '</button></footer>';
    var slot = root.querySelector('[data-as]');
    if (slot) Pcx.AddressSearch.mount(slot, { onPick: pickAddress });
  }

  /* ── actions ── */

  function pickAddress(a) {
    S.form = Object.assign(S.form || {}, { line1: a.line1, city: a.city || a.area, state: a.state, lat: a.lat, lng: a.lon, display_name: a.display_name });
    ['line1', 'city', 'state'].forEach(function (k) { var el = root.querySelector('[data-f="' + k + '"]'); if (el) el.value = S.form[k] || ''; });
    var el = root.querySelector('[data-f="line1"]'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function readForm() {
    root.querySelectorAll('[data-f]').forEach(function (i) { S.form[i.dataset.f] = i.value.trim(); });
    var s = D.session(); if (s) S.form.email = s.user.email;
    return S.form;
  }

  function saveAddressAction() {
    var f = readForm();
    if (!f.name || !f.phone || !f.line1) { D.toast('Add your name, phone and street address'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email || '')) { D.toast('Add a valid email for your receipt'); return; }
    S.delivery = { name: f.name, phone: f.phone, email: f.email, line1: f.line1, city: f.city || '', state: f.state || '',
      lat: f.lat == null ? null : f.lat, lng: f.lng == null ? null : f.lng, display_name: f.display_name || '', address_id: null, dirty: true };
    S.editing = false; S.error = ''; render();
  }

  async function persistDetails() {
    var s = D.session(), d = S.delivery;
    try {
      if (!S.saveFlag) return;
      if (s) {
        var uid = s.user.id;
        if (!S.profile || S.profile.full_name !== d.name || S.profile.phone !== d.phone) await Buyer.saveProfile(D.sb, uid, { full_name: d.name, phone: d.phone });
        if (d.dirty) await Buyer.saveAddress(D.sb, uid, { label: 'Home', full_name: d.name, phone: d.phone, line1: d.line1, city: d.city, state: d.state, lat: d.lat, lng: d.lng, display_name: d.display_name, is_default: !S.addresses.length });
      } else Buyer.saveGuest(d);
    } catch (_) { /* saving is a convenience; never block a payment on it */ }
  }

  async function pay() {
    var d = S.delivery;
    if (!Buyer.complete(d)) { S.editing = true; render(); return; }
    S.busy = true; S.error = ''; render();
    try {
      var h = { 'Content-Type': 'application/json' }; if (token()) h.Authorization = 'Bearer ' + token();
      var r = await fetch('/api/checkout', { method: 'POST', headers: h, body: JSON.stringify({
        items: D.cart().map(function (x) { return { product_id: x.id, qty: x.qty }; }), method: S.method,
        delivery: { name: d.name, phone: d.phone, email: d.email, line1: d.line1, city: d.city, state: d.state, lat: d.lat, lng: d.lng, display_name: d.display_name } }) });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start the payment');
      await persistDetails();
      try { localStorage.setItem(PENDING_KEY, JSON.stringify({ reference: j.reference, order_id: j.order_id, guest_token: j.guest_token || null, at: Date.now() })); } catch (_) {}
      global.location.href = j.authorization_url;
    } catch (e) {
      S.busy = false; S.error = e.message; render(); D.toast(e.message);
    }
  }

  function onClick(e) {
    var t = e.target.closest('[data-a]');
    if (!t || !root.contains(t)) return;
    var a = t.dataset.a;
    if (a === 'back') close();
    else if (a === 'edit') { S.editing = true; render(); }
    else if (a === 'cancel-edit') { S.editing = false; render(); }
    else if (a === 'save-address') saveAddressAction();
    else if (a === 'save-flag') S.saveFlag = t.checked;
    else if (a === 'method') { S.method = t.dataset.id; render(); }
    else if (a === 'pay') pay();
    else if (a === 'use-addr') {
      var ad = S.addresses.find(function (x) { return String(x.id) === t.dataset.id; });
      var s = D.session();
      S.delivery = Buyer.fromSaved(S.profile, ad, s && s.user.email); S.editing = false; render();
    }
  }

  /* ── open / close ── */

  function ensureRoot() {
    if (root) return;
    root = document.getElementById('chkPage');
    if (!root) { root = document.createElement('div'); root.id = 'chkPage'; document.body.appendChild(root); }
    root.addEventListener('click', onClick);
  }

  async function open() {
    if (!D.cart().length) { D.toast('Your cart is empty'); return; }
    ensureRoot();
    S = { loading: true, methods: [], method: null, pricing: { delivery_fee: 0, service_fee: 0, tax_rate: 0 }, configured: true, isTest: false, saveFlag: true, busy: false, error: '', editing: false, delivery: null, form: {}, addresses: [], profile: null };
    root.classList.add('open'); document.body.style.overflow = 'hidden'; render();
    await Promise.all([loadSaved(), loadMethods()]);
    S.loading = false; render();
  }
  function close() {
    if (!root) return;
    root.classList.remove('open'); document.body.style.overflow = '';
    if (D.onExit) D.onExit();
  }

  /* ── payment result ── */

  function resultRoot() {
    var el = document.getElementById('payResult');
    if (!el) { el = document.createElement('div'); el.id = 'payResult'; document.body.appendChild(el); }
    return el;
  }

  function pendingInfo() { try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || null; } catch (_) { return null; } }

  async function orderStatus(orderId, guestToken) {
    var h = {}; if (token()) h.Authorization = 'Bearer ' + token();
    var r = await fetch('/api/order-status?order_id=' + orderId + (guestToken ? '&token=' + encodeURIComponent(guestToken) : ''), { headers: h });
    return r.ok ? r.json() : null;
  }

  function showResult(kind, o, sellers) {
    var el = resultRoot();
    var title = { ok: 'Payment successful', wait: 'Confirming your payment', fail: 'Payment did not go through' }[kind];
    var icon = { ok: ICON.check, wait: ICON.clock, fail: ICON.cross }[kind];
    var body = kind === 'ok'
      ? '<p>Thank you! Your order <b>#' + esc(o.id) + '</b> is confirmed.</p>' + (o.is_test ? '<div class="ck-test"><b>TEST</b> This was a test payment. No real money moved.</div>' : '') +
        '<div class="pr-box"><div class="ck-row"><span>Paid</span><b>' + D.fmt(o.total) + '</b></div>' +
        (sellers || []).map(function (s) { return '<div class="ck-row"><span>' + esc(s.seller) + '</span><span class="pr-st">' + esc(s.status) + '</span></div>'; }).join('') + '</div>'
      : kind === 'wait' ? '<p>Your bank is still confirming. This can take a minute. You will not be charged twice.</p>'
      : '<p>' + esc((o && o.reason) || 'Your card or bank did not approve the payment.') + ' Nothing was charged.</p>';
    var btns = kind === 'ok'
      ? '<button class="ck-pay" data-r="orders">' + (D.session() ? 'Track my orders' : 'Continue shopping') + '</button><button class="ck-btn" data-r="home">Continue shopping</button>'
      : kind === 'wait' ? '<button class="ck-pay" data-r="recheck">Check again</button><button class="ck-btn" data-r="home">Back to store</button>'
      : '<button class="ck-pay" data-r="retry">Try again</button><button class="ck-btn" data-r="cart">Back to cart</button>';
    el.className = 'open pr-' + kind;
    el.innerHTML = '<div class="pr-card"><div class="pr-ico">' + icon + '</div><h2>' + title + '</h2>' + body + '<div class="pr-btns">' + btns + '</div></div>';
  }

  async function handleReturn() {
    var q = new URLSearchParams(global.location.search);
    if (!q.get('pay_return')) return false;
    var pend = pendingInfo();
    var ref = q.get('reference') || q.get('trxref') || (pend && pend.reference);
    var clean = function () { history.replaceState(null, '', global.location.pathname + global.location.hash); };
    if (!ref) { clean(); return false; }
    var el = resultRoot();
    var run = async function (attempt) {
      showResult('wait', {});
      var r = await fetch('/api/payment-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: ref }) });
      var j = await r.json().catch(function () { return {}; });
      var st = j.payment_status;
      if (['paid', 'partially_refunded', 'refunded'].indexOf(st) !== -1) {
        var os = await orderStatus(j.order_id, pend && pend.guest_token);
        try { localStorage.removeItem(PENDING_KEY); } catch (_) {}
        D.onPaid();
        showResult('ok', os ? os.order : { id: j.order_id, total: 0 }, os && os.sellers);
      } else if (st === 'failed') {
        showResult('fail', {});
      } else if (attempt < 3) {
        setTimeout(function () { run(attempt + 1); }, 4000);
      } else showResult('wait', {});
    };
    el.onclick = async function (e) {
      var b = e.target.closest('[data-r]'); if (!b) return;
      var a = b.dataset.r;
      if (a === 'recheck') run(3);
      else if (a === 'home') { el.className = ''; el.innerHTML = ''; }
      else if (a === 'cart') { el.className = ''; el.innerHTML = ''; if (D.openCart) D.openCart(); }
      else if (a === 'orders') { el.className = ''; el.innerHTML = ''; if (D.session() && D.openOrders) D.openOrders(); }
      else if (a === 'retry') {
        if (!pend || !pend.order_id) { el.className = ''; return; }
        b.disabled = true;
        var h = { 'Content-Type': 'application/json' }; if (token()) h.Authorization = 'Bearer ' + token();
        var r = await fetch('/api/checkout', { method: 'POST', headers: h, body: JSON.stringify({ order_id: pend.order_id, guest_token: pend.guest_token, method: S && S.method }) });
        var j = await r.json();
        if (r.ok) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(Object.assign({}, pend, { reference: j.reference }))); } catch (_) {} global.location.href = j.authorization_url; }
        else { D.toast(j.error || 'Could not restart the payment'); b.disabled = false; }
      }
    };
    clean();
    await run(0);
    return true;
  }

  function init(deps) { D = deps; }

  (global.Pcx = global.Pcx || {}).Checkout = { init: init, open: open, close: close, handleReturn: handleReturn };
})(window);
