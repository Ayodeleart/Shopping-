/* Pcx.OrderTracking: the customer's tracking page. One card per seller/shipment, each with its own status,
 * tracking number, carrier, estimated delivery and a timeline built from the real tracking events.
 * Opened through #order=ID (push notifications and emails link here), so the back button closes it.
 *
 *   const page = new Pcx.OrderTracking(document.getElementById('orderPage'), { sb, fmt: n => '₦' + n, onBack() {}, needSignIn() {} });
 *   page.open(orderId);   page.close();
 *
 * Customers can only read their own order (row level security); this page never changes anything.
 * Needs data/tracking.js and components/order-tracking.css.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};
  var T = function () { return Pcx.Tracking; };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';

  function OrderTracking(root, deps) {
    this.root = root; this.d = deps; this.isOpen = false; this.orderId = null;
    root.innerHTML = '<div class="ot-hdr"><button type="button" class="ot-back" aria-label="Back">' + BACK + '</button><div class="ot-title">Order</div>' +
      '<button type="button" class="ot-refresh" aria-label="Refresh">Refresh</button></div><div class="ot-body"></div>';
    var self = this;
    root.querySelector('.ot-back').addEventListener('click', function () { self.d.onBack(); });
    root.querySelector('.ot-refresh').addEventListener('click', function () { if (self.orderId) self.load(); });
    root.addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('[data-copy]') : null;
      if (c && navigator.clipboard) { navigator.clipboard.writeText(c.getAttribute('data-copy')).then(function () { c.textContent = 'Copied'; setTimeout(function () { c.textContent = 'Copy'; }, 1500); }); }
    });
  }
  var P = OrderTracking.prototype;

  P.open = function (orderId) {
    this.orderId = orderId;
    if (!this.isOpen) { this.isOpen = true; this.root.classList.add('open'); document.body.style.overflow = 'hidden'; }
    this.root.scrollTop = 0;
    this.load();
  };
  P.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false; this.root.classList.remove('open'); document.body.style.overflow = '';
  };

  P.body = function () { return this.root.querySelector('.ot-body'); };
  P.message = function (title, text, btn) {
    this.body().innerHTML = '<div class="ot-empty"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' + (btn ? '<button type="button" data-a="signin">' + esc(btn) + '</button>' : '') + '</div>';
    var b = this.body().querySelector('[data-a="signin"]'), self = this;
    if (b) b.addEventListener('click', function () { self.d.needSignIn(); });
  };

  P.load = async function () {
    var self = this, id = this.orderId;
    this.body().innerHTML = '<div class="ot-empty">Loading...</div>';
    var s = await this.d.sb.auth.getSession();
    if (!s.data.session) { this.message('Sign in to track your order', 'Order tracking is shown to the account that placed the order.', 'Sign in'); return; }
    try {
      var data = await T().loadOrder(this.d.sb, id);
      if (id !== this.orderId) return;
      if (!data.order) { this.message('We couldn\'t find this order', 'Check that you are signed in with the account you used to place it.'); return; }
      this.render(data);
    } catch (e) {
      this.message('Could not load this order', T().cleanError(e.message));
    }
  };

  P.render = function (data) {
    var Tk = T(), o = data.order, fmt = this.d.fmt || function (n) { return String(n); };
    this.root.querySelector('.ot-title').textContent = 'Order #' + o.order_number;
    var est = Tk.overallEstimate(data.shipments);
    var imgById = {};
    (o.items || []).forEach(function (i) { if (i && i.id != null) imgById[i.id] = i.image_url; });

    var html = '<div class="ot-sum"><div class="ot-sum-top"><span class="ot-num">#' + esc(o.order_number) + '</span>' +
      '<span class="tk-pill ' + Tk.tone(o.fulfillment_status) + '">' + esc(Tk.ORDER_LABEL[o.fulfillment_status] || o.fulfillment_status) + '</span></div>' +
      '<div class="ot-meta">Placed ' + esc(Tk.fmtTime(o.created_at)) + '<br>' + esc(Tk.PAY_LABEL[o.payment_status] || o.payment_status) + ' &middot; ' + esc(fmt(o.total || 0)) +
      (est ? '<br>Estimated delivery: <b>' + esc(Tk.fmtDay(est)) + '</b>' : '') +
      (data.shipments.length > 1 ? '<br>' + data.shipments.length + ' shipments, each tracked on its own below' : '') + '</div></div>';

    data.shipments.forEach(function (sh) { html += this.shipmentCard(sh, data, imgById, fmt); }, this);

    html += '<div class="ot-sec-h">Delivery address</div><div class="ot-sum"><div class="ot-meta"><b>' + esc(o.customer_name) + '</b><br>' + esc(o.address) +
      (o.phone ? '<br>Phone ending ' + esc(String(o.phone).replace(/\D/g, '').slice(-3)) : '') + '</div></div>';
    this.body().innerHTML = html;
  };

  P.shipmentCard = function (sh, data, imgById, fmt) {
    var Tk = T(), seller = sh.vendor_id ? data.sellers[sh.vendor_id] : null;
    var name = seller ? seller.business_name : (this.d.storeName || 'Store');
    var items = data.items.filter(function (i) { return i.shipment_id === sh.id; });
    var carrier = data.carriers.filter(function (c) { return c.code === sh.carrier_code; })[0];
    var carrierName = sh.carrier_name || (carrier && carrier.name) || '';
    var link = Tk.trackingUrl(data.carriers, sh.carrier_code, sh.tracking_number);
    var tl = Tk.timeline(data.events, sh);

    var h = '<section class="ot-ship"><div class="ot-ship-top"><div class="ot-logo">' +
      (seller && seller.logo_url ? '<img src="' + esc(seller.logo_url) + '" alt="">' : esc(name.charAt(0).toUpperCase())) + '</div>' +
      '<div class="ot-seller"><b>' + esc(name) + '</b><span>Sold and shipped by this seller</span></div>' +
      '<span class="tk-pill ' + Tk.tone(sh.status) + '">' + esc(Tk.LABEL[sh.status] || sh.status) + '</span></div>';

    h += '<div class="ot-items">' + items.map(function (i) {
      var img = imgById[i.product_id];
      return '<div class="ot-item">' + (img ? '<img src="' + esc(img) + '" alt="">' : '<span class="ph"></span>') +
        '<div>' + esc(i.name) + '<br><small>Qty ' + esc(i.qty) + ' &middot; ' + esc(fmt(i.price * i.qty)) + '</small></div></div>';
    }).join('') + '</div>';

    var rows = [];
    if (carrierName) rows.push(['Carrier', esc(carrierName)]);
    if (sh.tracking_number) rows.push(['Tracking number', esc(sh.tracking_number) + '<span class="tk-copy" data-copy="' + esc(sh.tracking_number) + '">Copy</span>']);
    if (sh.estimated_delivery && ['delivered', 'cancelled', 'returned', 'refunded'].indexOf(sh.status) < 0) rows.push(['Estimated delivery', esc(Tk.fmtDay(sh.estimated_delivery))]);
    if (sh.shipped_at) rows.push(['Shipped', esc(Tk.fmtTime(sh.shipped_at))]);
    if (sh.delivered_at) rows.push(['Delivered', esc(Tk.fmtTime(sh.delivered_at))]);
    if (rows.length) {
      h += '<div class="tk-box">' + rows.map(function (r) { return '<div class="tk-kv"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('') +
        (link ? '<div style="margin-top:6px"><a class="tk-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Track with ' + esc(carrierName || 'the carrier') + ' &rarr;</a></div>' : '') + '</div>';
    } else {
      h += '<div class="tk-box"><div class="tk-kv"><span>Tracking number</span><span>Added when the seller ships</span></div></div>';
    }

    h += '<ul class="tl">' + tl.rows.map(function (r) {
      var mark = r.state === 'done' ? '&#10003;' : r.state === 'problem' ? '!' : '';
      var desc = r.event && r.event.description && ['order_placed', 'payment_confirmed'].indexOf(r.key) < 0 ? '<div class="tl-desc">' + esc(r.event.description) + '</div>' : '';
      return '<li class="' + r.state + '"><span class="tl-dot">' + mark + '</span><div class="tl-body"><div class="tl-lbl">' + esc(r.label) + '</div>' +
        (r.at ? '<div class="tl-at">' + esc(Tk.fmtTime(r.at)) + (r.event && r.event.location ? ' &middot; ' + esc(r.event.location) : '') + '</div>' : '') + desc + '</div></li>';
    }).join('') + '</ul>';

    h += '<details class="tk-hist"><summary>Full history (' + tl.history.length + ')</summary>' + tl.history.map(function (e) {
      return '<div class="tk-hist-row"><b>' + esc(Tk.LABEL[e.status] || e.title) + '</b> <span class="by">' + esc(Tk.fmtTime(e.occurred_at)) +
        (e.source === 'admin' ? ' &middot; updated by the store team' : '') + '</span>' +
        (e.description ? '<br>' + esc(e.description) : '') + (e.location ? '<br>' + esc(e.location) : '') +
        (e.tracking_number && ['shipped', 'tracking_updated'].indexOf(e.status) >= 0 ? '<br>Tracking ' + esc(e.tracking_number) + (e.carrier ? ' (' + esc(e.carrier) + ')' : '') : '') + '</div>';
    }).join('') + '</details></section>';
    return h;
  };

  Pcx.OrderTracking = OrderTracking;
})(window);
