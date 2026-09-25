/* Pcx.Profile: the signed-in buyer's profile page and everything behind it (settings, address book, orders).
 *
 *   Pcx.Profile.init({ sb, session: () => buyerSession, fmt, toast, signOut, openNotifPrefs, openLegal, openWishlist,
 *                      openHistory, openSupport, onClose });
 *   Pcx.Profile.open();
 *
 * Layout: a cover photo with the buyer's avatar, name and the wishlist / coupons / points counters on top of it,
 * then My Orders (status row), Services, and a Settings page. No bottom navigation: the back button returns to the store.
 * Needs: data/buyer.js, components/address-search.js
 */
(function (global) {
  'use strict';

  var D = null, root = null, ST = null;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var svg = function (p, s) { return '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; };
  var I = {
    back: svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
    cam: svg('<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>', 16),
    chev: svg('<polyline points="9 18 15 12 9 6"/>', 16),
    wallet: svg('<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 12h.01M3 10h18"/><path d="M7 6V4h10"/>', 26),
    box: svg('<path d="M21 16V8a2 2 0 00-1-1.7l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.7l7 4a2 2 0 002 0l7-4a2 2 0 001-1.7z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/>', 26),
    truck: svg('<rect x="1" y="4" width="14" height="12" rx="1"/><path d="M15 8h4l3 3v5h-7z"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>', 26),
    done: svg('<path d="M22 11.1V12a10 10 0 11-5.9-9.1"/><polyline points="22 4 12 14 9 11"/>', 26),
    refund: svg('<polyline points="1 4 1 10 7 10"/><path d="M3.5 15a9 9 0 105.6-11.5L1 10"/>', 26),
    history: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>', 26),
    pin: svg('<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>', 26),
    support: svg('<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>', 26),
    bell: svg('<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>', 26),
    shop: svg('<path d="M21 8l-3-5H6L3 8m18 0v11a1 1 0 01-1 1H4a1 1 0 01-1-1V8m18 0H3"/><path d="M9 12h6"/>', 26)
  };

  var STATUS_TABS = [['topay', 'To pay', 'wallet'], ['processing', 'Processing', 'box'], ['shipped', 'Shipped', 'truck'], ['delivered', 'Delivered', 'done'], ['refunds', 'Refunds', 'refund']];
  var PAY_LABEL = { pending: 'Awaiting payment', paid: 'Paid', failed: 'Payment failed', refunded: 'Refunded', partially_refunded: 'Partly refunded' };

  /* ── helpers ── */

  function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?'; }
  function user() { var s = D.session(); return s && s.user; }
  function displayName() {
    var u = user(), m = (u && u.user_metadata) || {};
    return (ST.profile && ST.profile.full_name) || m.full_name || m.name || (u && u.email ? u.email.split('@')[0] : 'My account');
  }
  function avatarUrl() { var m = (user() && user().user_metadata) || {}; return (ST.profile && ST.profile.avatar_url) || m.avatar_url || m.picture || ''; }

  /* resize in the browser first: keeps uploads small and fast on a phone */
  function shrink(file, w, h, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight);          // cover-crop from the centre
        var dw = img.naturalWidth * ratio, dh = img.naturalHeight * ratio;
        c.getContext('2d').drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not process the photo')); }, 'image/jpeg', quality);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not a photo')); };
      img.src = url;
    });
  }

  async function uploadPhoto(kind, file) {
    var uid = user().id;
    var blob = kind === 'avatar' ? await shrink(file, 480, 480, 0.86) : await shrink(file, 1400, 660, 0.82);
    var path = 'profiles/' + uid + '/' + kind + '_' + Date.now() + '.jpg';
    var up = await D.sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (up.error) throw new Error(/row-level security|policy/i.test(up.error.message) ? 'Photo upload is not switched on yet (storage policy missing).' : up.error.message);
    var url = D.sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    var old = ST.profile && ST.profile[kind + '_url'];
    ST.profile = await Buyer.saveProfile(D.sb, uid, kind === 'avatar' ? { avatar_url: url } : { cover_url: url });
    var m = old && /\/avatars\/(profiles\/[^?]+)/.exec(old);
    if (m) D.sb.storage.from('avatars').remove([decodeURIComponent(m[1])]).catch(function () {});      // best effort clean-up of the old photo
  }

  function pickFile(kind) {
    var i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    i.onchange = async function () {
      if (!i.files[0]) return;
      D.toast('Uploading photo...');
      try { await uploadPhoto(kind, i.files[0]); D.toast(kind === 'avatar' ? 'Profile photo updated' : 'Cover photo updated'); render(); }
      catch (e) { D.toast(e.message); }
    };
    i.click();
  }

  /* ── views ── */

  function head(title, right) {
    return '<header class="pf-nav"><button class="pf-nav__b" data-a="back" aria-label="Back">' + I.back + '</button><h2>' + esc(title) + '</h2><span class="pf-nav__r">' + (right || '') + '</span></header>';
  }

  function viewHome() {
    var c = ST.counts || { wishlist: 0, coupons: 0 }, pts = (ST.profile && ST.profile.points) || 0, oc = ST.orderCounts || {};
    var av = avatarUrl();
    var cover = ST.profile && ST.profile.cover_url ? ' style="background-image:url(\'' + esc(ST.profile.cover_url) + '\')"' : '';
    return '<div class="pf-cover' + (cover ? ' has-img' : '') + '"' + cover + '>' +
      '<div class="pf-cover__shade"></div>' +
      '<div class="pf-cover__top"><button class="pf-round" data-a="back" aria-label="Back">' + I.back + '</button><span style="flex:1"></span>' +
        '<button class="pf-round" data-a="cover" aria-label="Change cover photo">' + I.cam + '</button><button class="pf-round" data-a="settings" aria-label="Settings">' + I.gear + '</button></div>' +
      '<div class="pf-who"><button class="pf-avatar" data-a="avatar" aria-label="Change profile photo">' + (av ? '<img src="' + esc(av) + '" alt="">' : '<span>' + esc(initials(displayName())) + '</span>') + '<i>' + I.cam + '</i></button>' +
        '<div class="pf-who__t"><h1>' + esc(displayName()) + '</h1><span class="pf-chip">' + esc(user() ? user().email : '') + '</span></div></div>' +
      '<div class="pf-stats"><button data-a="wishlist"><b>' + c.wishlist + '</b><span>Wishlist</span></button><button data-a="coupons"><b>' + c.coupons + '</b><span>Coupons</span></button><button data-a="points"><b>' + pts + '</b><span>Points</span></button></div>' +
    '</div>' +
    '<div class="pf-sec"><div class="pf-sec__h"><h3>My Orders</h3><button data-a="orders" data-f="all">View all</button></div><div class="pf-status">' +
      STATUS_TABS.map(function (t) { var n = oc[t[0]] || 0; return '<button data-a="orders" data-f="' + t[0] + '"><span class="pf-ic">' + I[t[2]] + (n ? '<em>' + n + '</em>' : '') + '</span><span>' + t[1] + '</span></button>'; }).join('') + '</div></div>' +
    '<div class="pf-sec"><div class="pf-sec__h"><h3>Services</h3></div><div class="pf-svc">' +
      [['history', 'Browsing history', 'history'], ['addresses', 'Address book', 'pin'], ['support', 'Support', 'support'], ['notify', 'Notifications', 'bell'], ['sell', 'Sell on Marcato', 'shop']].map(function (s) {
        return '<button data-a="' + s[0] + '"><span class="pf-ic pf-ic--s">' + I[s[2]] + '</span><span>' + s[1] + '</span></button>'; }).join('') + '</div></div>';
  }

  function viewSettings() {
    var row = function (a, label, val, chev) { return '<button class="pf-row" data-a="' + a + '"' + (chev ? '' : ' disabled') + '><span>' + label + '</span><span class="pf-row__v">' + (val ? esc(val) : '') + (chev ? I.chev : '') + '</span></button>'; };
    var p = ST.profile || {};
    return head('Settings') + '<div class="pf-list">' +
      row('account', 'Account Settings', '', true) + row('addresses', 'Address Book', '', true) +
      row('x', 'Country', p.country || 'Nigeria', false) + row('x', 'Currency', p.currency || 'NGN', false) + row('x', 'Language', p.language || 'English', false) + '<div class="pf-gap"></div>' +
      row('notify', 'Notification Settings', '', true) + row('privacy', 'Privacy Policy', '', true) + '</div>' +
      '<div class="pf-pad"><button class="pf-out" data-a="signout">Log Out</button></div>';
  }

  function viewAccount() {
    var p = ST.profile || {}, av = avatarUrl();
    return head('Account Settings') + '<div class="pf-pad">' +
      '<div class="pf-photos"><button class="pf-photo pf-photo--a" data-a="avatar">' + (av ? '<img src="' + esc(av) + '" alt="">' : '<span>' + esc(initials(displayName())) + '</span>') + '<i>' + I.cam + '</i></button>' +
        '<button class="pf-photo pf-photo--c"' + (p.cover_url ? ' style="background-image:url(\'' + esc(p.cover_url) + '\')"' : '') + ' data-a="cover"><i>' + I.cam + ' Change cover</i></button></div>' +
      '<label class="pf-f"><span>Full name</span><input data-f="full_name" value="' + esc(p.full_name || displayName()) + '"></label>' +
      '<label class="pf-f"><span>Phone number</span><input data-f="phone" type="tel" value="' + esc(p.phone || '') + '"></label>' +
      '<label class="pf-f"><span>Email</span><input value="' + esc(user() ? user().email : '') + '" disabled></label>' +
      '<button class="pf-save" data-a="save-account">Save changes</button></div>';
  }

  function addrLine(a) { return [a.line1, a.city, a.state].filter(Boolean).join(', '); }

  function viewAddresses() {
    var list = ST.addresses || [];
    return head('Address Book') + '<div class="pf-pad">' + (list.length ? list.map(function (a) {
      return '<div class="pf-addr"><div class="pf-addr__h"><b>' + esc(a.label) + '</b>' + (a.is_default ? '<em>Default</em>' : '') + '</div>' +
        '<div class="pf-addr__n">' + esc([a.full_name, a.phone].filter(Boolean).join(' · ')) + '</div><div class="pf-addr__l">' + esc(addrLine(a)) + '</div>' +
        '<div class="pf-addr__a">' + (a.is_default ? '' : '<button data-a="addr-default" data-id="' + a.id + '">Set as default</button>') + '<button data-a="addr-edit" data-id="' + a.id + '">Edit</button><button data-a="addr-del" data-id="' + a.id + '" class="is-danger">Delete</button></div></div>';
    }).join('') : '<div class="pf-empty">No saved addresses yet. Add one and checkout will use it automatically.</div>') +
      '<button class="pf-save" data-a="addr-new">+ Add new address</button></div>';
  }

  function viewAddressEdit() {
    var a = ST.editAddr || {}, u = user();
    return head(a.id ? 'Edit address' : 'New address') + '<div class="pf-pad">' +
      '<div class="pf-sub">Find your address</div><div data-as></div><div class="pf-sub">Details</div>' +
      '<div class="pf-chips">' + ['Home', 'Work', 'Other'].map(function (l) { return '<button data-a="addr-label" data-l="' + l + '" class="' + ((a.label || 'Home') === l ? 'is-on' : '') + '">' + l + '</button>'; }).join('') + '</div>' +
      [['full_name', 'Full name', a.full_name || displayName()], ['phone', 'Phone number', a.phone || (ST.profile && ST.profile.phone) || ''], ['line1', 'Street address', a.line1 || ''], ['city', 'City / area', a.city || ''], ['state', 'State', a.state || '']].map(function (f) {
        return '<label class="pf-f"><span>' + f[1] + '</span><input data-f="' + f[0] + '" value="' + esc(f[2]) + '"' + (f[0] === 'phone' ? ' type="tel"' : '') + '></label>'; }).join('') +
      '<label class="pf-check"><input type="checkbox" data-f="is_default"' + (a.is_default || !(ST.addresses || []).length ? ' checked' : '') + '><span>Use as my default address</span></label>' +
      '<button class="pf-save" data-a="addr-save">Save address</button></div>';
  }

  function viewOrders() {
    var f = ST.filter || 'all';
    var tabs = [['all', 'All']].concat(STATUS_TABS.map(function (t) { return [t[0], t[1]]; }));
    var rows = ST.orders == null ? '<div class="pf-empty">Loading orders...</div>'
      : ST.orders.filter(function (o) { return f === 'all' || Buyer.bucket(o) === f; }).map(function (o) {
        var subs = o.shipments || [], legacyCount = (o.items || []).length, count = subs.length ? subs.reduce(function (n, s) { return n + (s.order_items || []).reduce(function (m, i) { return m + i.qty; }, 0); }, 0) : legacyCount;
        var unpaid = o.payment_reference && ['pending', 'failed', 'cancelled', 'processing'].indexOf(o.payment_status) !== -1 && o.status !== 'cancelled';
        return '<div class="pf-ord"><div class="pf-ord__h"><b>Order #' + o.id + '</b><span>' + new Date(o.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) + '</span></div>' +
          '<div class="pf-pills"><i class="st-' + esc(o.status) + '">' + esc(o.status) + '</i>' + (o.payment_reference ? '<i class="pay-' + esc(o.payment_status) + '">' + esc(PAY_LABEL[o.payment_status] || o.payment_status) + '</i>' : '') + (o.is_test ? '<i class="pay-test">Test</i>' : '') + '</div>' +
          '<div class="pf-ord__t">' + count + ' item' + (count === 1 ? '' : 's') + (subs.length > 1 ? ' from ' + subs.length + ' sellers' : '') + ' <b>' + D.fmt(o.total) + '</b></div>' +
          '<div class="pf-ord__a">' + (unpaid ? '<button class="pf-mini is-red" data-a="pay-now" data-id="' + o.id + '">Pay now</button>' : '') + '<button class="pf-mini" data-a="order" data-id="' + o.id + '">Details</button></div></div>';
      }).join('') || '<div class="pf-empty">Nothing here yet.</div>';
    return head('My Orders') + '<div class="pf-tabs">' + tabs.map(function (t) { return '<button data-a="orders" data-f="' + t[0] + '" class="' + (t[0] === f ? 'is-on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="pf-pad">' + rows + '</div>';
  }

  function viewOrder() {
    var o = (ST.orders || []).find(function (x) { return String(x.id) === String(ST.orderId); });
    if (!o) return head('Order') + '<div class="pf-pad"><div class="pf-empty">Order not found.</div></div>';
    var subs = o.shipments || [], d = o.delivery || {};
    var row = function (l, v, b) { return '<div class="pf-kv' + (b ? ' is-b' : '') + '"><span>' + l + '</span><span>' + v + '</span></div>'; };
    return head('Order #' + o.id) + '<div class="pf-pad">' +
      '<div class="pf-card"><div class="pf-pills"><i class="st-' + esc(o.status) + '">' + esc(o.status) + '</i>' + (o.payment_reference ? '<i class="pay-' + esc(o.payment_status) + '">' + esc(PAY_LABEL[o.payment_status] || o.payment_status) + '</i>' : '') + '</div>' +
        (o.is_test ? '<div class="pf-test">Test payment: no real money moved.</div>' : '') +
        '<div class="pf-mute">Placed ' + new Date(o.created_at).toLocaleString('en-NG') + '</div></div>' +
      (subs.length ? subs.map(function (s) {
        return '<div class="pf-card"><div class="pf-card__h"><b>Sold by ' + esc((s.vendors && s.vendors.business_name) || 'Marcato') + '</b><i class="st-' + esc(s.status) + '">' + esc(s.status) + '</i></div>' +
          (s.order_items || []).map(function (i) { return '<div class="pf-line"><span>' + esc(i.name) + ' &times; ' + i.qty + '</span><span>' + D.fmt(i.line_total || i.price * i.qty) + '</span></div>'; }).join('') +
          (s.tracking_number ? '<div class="pf-mute">Tracking: ' + esc(s.tracking_number) + (s.carrier_name ? ' (' + esc(s.carrier_name) + ')' : '') + '</div>' : '') + '</div>';
      }).join('') : '<div class="pf-card"><div class="pf-card__h"><b>Items</b></div>' + (o.items || []).map(function (i) { return '<div class="pf-line"><span>' + esc(i.name) + ' &times; ' + i.qty + '</span><span>' + D.fmt(i.price * i.qty) + '</span></div>'; }).join('') + '</div>') +
      '<div class="pf-card">' + (o.subtotal != null ? row('Items', D.fmt(o.subtotal)) + row('Delivery', Number(o.delivery_fee) ? D.fmt(o.delivery_fee) : 'Free') + (Number(o.service_fee) ? row('Service fee', D.fmt(o.service_fee)) : '') + (Number(o.tax) ? row('Tax', D.fmt(o.tax)) : '') : '') +
        row('Total', D.fmt(o.total), true) + (Number(o.refunded_amount) ? row('Refunded', D.fmt(o.refunded_amount)) : '') + '</div>' +
      '<div class="pf-card"><div class="pf-card__h"><b>Delivery</b></div><div class="pf-mute" style="color:var(--txt2)">' + esc(o.customer_name || d.name || '') + '<br>' + esc(o.phone || d.phone || '') + '<br>' + esc(o.address || '') + '</div>' +
        (o.payment_reference ? '<div class="pf-mute" style="margin-top:10px">Payment ref ' + esc(o.payment_reference) + '</div>' : '') + '</div></div>';
  }

  function viewSheet() {
    var t = ST.sheet;
    return head(t.title) + '<div class="pf-pad">' + t.html + '</div>';
  }

  /* ── render & navigation ── */

  function render() {
    if (!root) return;
    var v = ST.stack[ST.stack.length - 1];
    var html = ({ home: viewHome, settings: viewSettings, account: viewAccount, addresses: viewAddresses, 'address-edit': viewAddressEdit, orders: viewOrders, order: viewOrder, sheet: viewSheet }[v] || viewHome)();
    root.innerHTML = '<div class="pf-scroll">' + html + '</div>';
    root.classList.toggle('is-home', v === 'home');
    var slot = root.querySelector('[data-as]');
    if (slot) Pcx.AddressSearch.mount(slot, { onPick: function (a) {
      ST.editAddr = Object.assign(ST.editAddr || {}, { line1: a.line1, city: a.city || a.area, state: a.state, lat: a.lat, lng: a.lon, display_name: a.display_name });
      ['line1', 'city', 'state'].forEach(function (k) { var el = root.querySelector('[data-f="' + k + '"]'); if (el) el.value = ST.editAddr[k] || ''; });
    } });
  }
  function go(view) { ST.stack.push(view); render(); root.scrollTop = 0; var s = root.querySelector('.pf-scroll'); if (s) s.scrollTop = 0; }
  function back() { if (ST.stack.length > 1) { ST.stack.pop(); render(); } else close(); }

  function formValues() { var o = {}; root.querySelectorAll('[data-f]:not([data-a])').forEach(function (i) { o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value.trim(); }); return o; }

  async function loadOrders() {
    var r = await D.sb.from('orders').select('*, shipments(id,status,subtotal,tracking_number,carrier_name,vendors(business_name),order_items(name,qty,price,line_total))').eq('user_id', user().id).order('created_at', { ascending: false });
    ST.orders = r.error ? [] : (r.data || []);
  }
  async function refreshAddresses() { ST.addresses = await Buyer.addresses(D.sb, user().id); }

  async function payNow(id) {
    var s = D.session();
    var r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.access_token }, body: JSON.stringify({ order_id: Number(id) }) });
    var j = await r.json();
    if (!r.ok) { D.toast(j.error || 'Could not start the payment'); return; }
    try { localStorage.setItem('mct_pending_v1', JSON.stringify({ reference: j.reference, order_id: j.order_id, guest_token: null, at: Date.now() })); } catch (_) {}
    global.location.href = j.authorization_url;
  }

  async function onClick(e) {
    var b = e.target.closest('[data-a]');
    if (!b || !root.contains(b)) return;
    var a = b.dataset.a;
    try {
      switch (a) {
        case 'back': return back();
        case 'settings': return go('settings');
        case 'account': return go('account');
        case 'avatar': return pickFile('avatar');
        case 'cover': return pickFile('cover');
        case 'save-account': {
          var v = formValues();
          ST.profile = await Buyer.saveProfile(D.sb, user().id, { full_name: v.full_name || null, phone: v.phone || null });
          D.toast('Saved'); return back();
        }
        case 'addresses': await refreshAddresses(); return go('addresses');
        case 'addr-new': ST.editAddr = {}; return go('address-edit');
        case 'addr-edit': ST.editAddr = Object.assign({}, ST.addresses.find(function (x) { return String(x.id) === b.dataset.id; })); return go('address-edit');
        case 'addr-label': ST.editAddr = Object.assign(ST.editAddr || {}, formValues(), { label: b.dataset.l }); return render();
        case 'addr-save': {
          var f = formValues(), cur = ST.editAddr || {};
          await Buyer.saveAddress(D.sb, user().id, { id: cur.id, label: cur.label || 'Home', full_name: f.full_name, phone: f.phone, line1: f.line1, city: f.city, state: f.state, lat: cur.lat, lng: cur.lng, display_name: cur.display_name, is_default: f.is_default });
          await refreshAddresses(); D.toast('Address saved'); ST.stack.pop(); return render();
        }
        case 'addr-default': await Buyer.setDefault(D.sb, user().id, Number(b.dataset.id)); await refreshAddresses(); return render();
        case 'addr-del': if (global.confirm('Delete this address?')) { await Buyer.deleteAddress(D.sb, user().id, Number(b.dataset.id)); await refreshAddresses(); render(); } return;
        case 'orders': ST.filter = b.dataset.f || 'all'; if (ST.stack[ST.stack.length - 1] !== 'orders') go('orders'); else render(); if (ST.orders == null) { await loadOrders(); render(); } return;
        case 'order': ST.orderId = b.dataset.id; return go('order');
        case 'pay-now': b.disabled = true; return payNow(b.dataset.id);
        case 'wishlist': close(); return D.openWishlist && D.openWishlist();
        case 'history': close(); return D.openHistory && D.openHistory();
        case 'support': return D.openSupport && D.openSupport();
        case 'notify': close(); return D.openNotifPrefs && D.openNotifPrefs();
        case 'sell': return global.open('/vendor/', '_blank');
        case 'privacy': close(); return D.openLegal && D.openLegal('privacy');
        case 'signout': close(); return D.signOut();
        case 'coupons': {
          var r = await D.sb.from('user_coupons').select('*').eq('user_id', user().id).is('used_at', null).order('created_at', { ascending: false });
          ST.sheet = { title: 'Coupons', html: (r.data && r.data.length) ? r.data.map(function (c) { return '<div class="pf-card"><b>' + esc(c.title || c.code) + '</b><div class="pf-mute">Code ' + esc(c.code) + (c.expires_at ? ' &middot; expires ' + new Date(c.expires_at).toLocaleDateString('en-NG') : '') + '</div></div>'; }).join('') : '<div class="pf-empty">No coupons yet. Coupons you receive will appear here.</div>' };
          return go('sheet');
        }
        case 'points':
          ST.sheet = { title: 'Points', html: '<div class="pf-card" style="text-align:center"><div style="font-size:38px;font-weight:800">' + ((ST.profile && ST.profile.points) || 0) + '</div><div class="pf-mute">Your points balance</div></div><div class="pf-empty">Points you earn will be added here.</div>' };
          return go('sheet');
      }
    } catch (err) { D.toast(err.message || 'Something went wrong'); }
  }

  async function open() {
    if (!user()) return false;
    if (!root) {
      root = document.getElementById('profPage');
      if (!root) { root = document.createElement('div'); root.id = 'profPage'; document.body.appendChild(root); }
      root.addEventListener('click', onClick);
    }
    ST = { stack: ['home'], profile: null, counts: null, orderCounts: null, addresses: [], orders: null, filter: 'all' };
    root.classList.add('open'); document.body.style.overflow = 'hidden'; render();
    var uid = user().id;
    var res = await Promise.all([Buyer.profile(D.sb, uid), Buyer.counts(D.sb, uid), Buyer.orderCounts(D.sb, uid)]);
    ST.profile = res[0]; ST.counts = res[1]; ST.orderCounts = res[2];
    if (ST.stack.length === 1) render();
    return true;
  }
  function close() { if (!root) return; root.classList.remove('open'); document.body.style.overflow = ''; if (D.onClose) D.onClose(); }
  function openOrders(filter) { return open().then(function () { ST.filter = filter || 'all'; go('orders'); return loadOrders().then(render); }); }

  (global.Pcx = global.Pcx || {}).Profile = { init: function (d) { D = d; }, open: open, close: close, openOrders: openOrders };
})(window);
