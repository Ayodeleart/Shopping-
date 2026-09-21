/* Pcx.NotificationCenter: the customer's notification list and settings.
 *
 * The list is the real `notifications` table (created by the database when an order event happens), so it is never
 * out of step with what was pushed or emailed. Order, delivery and payment notices are always kept here; the switches in
 * Settings only decide whether we also send a push or an email, and the Promotions switch never affects order updates.
 *
 *   const nc = new Pcx.NotificationCenter(el, { sb, openOrder(id) {}, enablePush() -> Promise, pushState() -> Promise<string>, onUnread(n) {}, onBack() {} });
 *   nc.open();  nc.close();  nc.refreshUnread();
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
  var ICON = { order: '\uD83D\uDCE6', delivery: '\uD83D\uDE9A', payment: '\uD83D\uDCB3', promo: '\uD83C\uDFF7\uFE0F' };
  var TABS = [['all', 'All'], ['order', 'Orders'], ['delivery', 'Delivery'], ['payment', 'Payments & refunds']];
  var PREFS = [
    ['order_updates', 'Order updates', 'Order placed, processing, cancellations'],
    ['delivery_updates', 'Delivery updates', 'Shipped, on the way, delivered, delivery problems'],
    ['payment_updates', 'Payments & refunds', 'Payment confirmed, refunds'],
    ['promotional', 'Promotions & offers', 'Sales and announcements. Never affects order updates']
  ];
  var DEFAULTS = { order_updates: true, delivery_updates: true, payment_updates: true, promotional: true, push_enabled: true, email_enabled: true };

  function ago(iso) {
    var s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.round(s / 86400) + ' d ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function NotificationCenter(root, deps) {
    this.root = root; this.d = deps; this.isOpen = false; this.tab = 'all'; this.items = []; this.prefs = Object.assign({}, DEFAULTS);
    root.innerHTML = '<div class="nc-hdr"><button type="button" class="nc-back" aria-label="Back">' + BACK + '</button>' +
      '<div class="nc-title">Notifications<span class="nc-count" hidden></span></div><button type="button" class="nc-markall">Mark all read</button></div>' +
      '<div class="nc-body"><div class="nc-tabs"></div><div class="nc-list"></div><div class="nc-prefs"></div></div>';
    var self = this;
    root.querySelector('.nc-back').addEventListener('click', function () { self.d.onBack(); });
    root.querySelector('.nc-markall').addEventListener('click', function () { self.markAll(); });
    root.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-tab]') : null;
      if (t) { self.tab = t.getAttribute('data-tab'); self.paint(); return; }
      var it = e.target.closest ? e.target.closest('[data-n]') : null;
      if (it) { self.openItem(Number(it.getAttribute('data-n'))); return; }
      var tg = e.target.closest ? e.target.closest('[data-pref]') : null;
      if (tg) { self.togglePref(tg.getAttribute('data-pref')); return; }
      if (e.target.closest && e.target.closest('.nc-push')) self.turnOnPush();
    });
  }
  var P = NotificationCenter.prototype;

  P.open = function () {
    if (!this.isOpen) { this.isOpen = true; this.root.classList.add('open'); document.body.style.overflow = 'hidden'; }
    this.root.scrollTop = 0;
    this.load();
  };
  P.close = function () { if (!this.isOpen) return; this.isOpen = false; this.root.classList.remove('open'); document.body.style.overflow = ''; };

  P.load = async function () {
    var list = this.root.querySelector('.nc-list');
    var s = await this.d.sb.auth.getSession();
    if (!s.data.session) { list.innerHTML = '<div class="nc-empty">Sign in to see your order notifications.</div>'; this.root.querySelector('.nc-prefs').innerHTML = ''; return; }
    this.uid = s.data.session.user.id;
    list.innerHTML = '<div class="nc-empty">Loading...</div>';
    var r = await Promise.all([
      this.d.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
      this.d.sb.from('notification_preferences').select('*').eq('user_id', this.uid).maybeSingle()
    ]);
    if (r[0].error) { list.innerHTML = '<div class="nc-empty">Could not load notifications.<br>' + esc(r[0].error.message) + '</div>'; return; }
    this.items = r[0].data || [];
    this.prefs = Object.assign({}, DEFAULTS, r[1].data || {});
    this.paint();
    this.paintPrefs();
  };

  P.unread = function () { return this.items.filter(function (n) { return !n.is_read; }).length; };

  P.paint = function () {
    var self = this, un = this.unread();
    var c = this.root.querySelector('.nc-count'); c.hidden = !un; c.textContent = un;
    this.root.querySelector('.nc-markall').disabled = !un;
    this.root.querySelector('.nc-tabs').innerHTML = TABS.map(function (t) {
      return '<button type="button" class="nc-tab' + (self.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
    var rows = this.items.filter(function (n) { return self.tab === 'all' || n.category === self.tab; });
    this.root.querySelector('.nc-list').innerHTML = rows.length ? rows.map(function (n) {
      return '<div class="nc-item' + (n.is_read ? '' : ' unread') + '" data-n="' + n.id + '"><div class="nc-ico">' + (ICON[n.category] || '\uD83D\uDD14') + '</div>' +
        '<div class="nc-main"><div class="nc-t">' + (n.is_read ? '' : '<i></i>') + esc(n.title) + '</div><div class="nc-m">' + esc(n.message) + '</div>' +
        '<div class="nc-when">' + esc(ago(n.created_at)) + '</div></div></div>';
    }).join('') : '<div class="nc-empty">' + (this.tab === 'all' ? 'No notifications yet. Order updates will show up here.' : 'Nothing here yet.') + '</div>';
    if (this.d.onUnread) this.d.onUnread(un);
  };

  P.paintPrefs = async function () {
    var self = this, el = this.root.querySelector('.nc-prefs');
    var state = this.d.pushState ? await this.d.pushState() : 'unsupported';
    var msg = { granted: 'Push notifications are on for this device.', denied: 'Notifications are blocked in your browser settings for this site.',
                unsupported: 'This browser does not support push notifications. You will still see updates here and by email.', 'default': 'Turn on push to hear about your order the moment it changes.' }[state] || '';
    el.innerHTML = '<h4>Notification settings</h4><div class="nc-note">Order, delivery and payment updates are always kept in this list. These switches decide whether we also push or email them.</div>' +
      PREFS.map(function (p) {
        return '<div class="nc-row"><div><b>' + p[1] + '</b><small>' + p[2] + '</small></div><div class="nc-tgl' + (self.prefs[p[0]] ? ' on' : '') + '" role="switch" aria-checked="' + !!self.prefs[p[0]] + '" data-pref="' + p[0] + '"></div></div>';
      }).join('') +
      '<div class="nc-row"><div><b>Push notifications</b><small>On this and your other devices</small></div><div class="nc-tgl' + (this.prefs.push_enabled ? ' on' : '') + '" role="switch" data-pref="push_enabled"></div></div>' +
      '<div class="nc-row"><div><b>Email</b><small>Order updates to your account email</small></div><div class="nc-tgl' + (this.prefs.email_enabled ? ' on' : '') + '" role="switch" data-pref="email_enabled"></div></div>' +
      (state === 'granted' || state === 'unsupported' ? '' : '<button type="button" class="nc-push"' + (state === 'denied' ? ' disabled' : '') + '>Enable push on this device</button>') +
      '<div class="nc-status">' + esc(msg) + '</div>';
  };

  P.togglePref = async function (key) {
    this.prefs[key] = !this.prefs[key];
    this.paintPrefs();
    var row = Object.assign({ user_id: this.uid, updated_at: new Date().toISOString() }, this.prefs);
    var r = await this.d.sb.from('notification_preferences').upsert(row, { onConflict: 'user_id' });
    if (r.error) { this.prefs[key] = !this.prefs[key]; this.paintPrefs(); if (this.d.toast) this.d.toast('Could not save: ' + r.error.message); }
  };

  P.turnOnPush = async function () {
    try { await this.d.enablePush(); } finally { this.paintPrefs(); }
  };

  P.openItem = async function (id) {
    var n = this.items.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    if (!n.is_read) {
      n.is_read = true; this.paint();
      this.d.sb.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id).then(function () {});
    }
    if (n.order_id) this.d.openOrder(n.order_id);
  };

  P.markAll = async function () {
    var now = new Date().toISOString();
    this.items.forEach(function (n) { n.is_read = true; });
    this.paint();
    await this.d.sb.from('notifications').update({ is_read: true, read_at: now }).eq('is_read', false);
  };

  P.refreshUnread = async function () {
    var s = await this.d.sb.auth.getSession();
    if (!s.data.session) { if (this.d.onUnread) this.d.onUnread(0); return; }
    var r = await this.d.sb.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false);
    if (!r.error && this.d.onUnread) this.d.onUnread(r.count || 0);
  };

  Pcx.NotificationCenter = NotificationCenter;
})(window);
