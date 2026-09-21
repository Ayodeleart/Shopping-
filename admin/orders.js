/* Admin: orders, shipments and tracking.
 *
 * Orders view: every order with its payment state and the derived fulfilment state; open one to see each seller's shipment,
 * the full tracking history, and to correct things. Shipments view: every shipment across all orders (filter by status).
 * Every manual change is a call to the same server function sellers use (rpc record_tracking_event) and is written to the
 * history as an admin change, so it is visible to the customer and the seller. Payment confirmation, cancellation and
 * refunds are admin-only in the database, not just hidden in this page.
 *
 * Uses page globals: sb, toast, confirm, fmt, deleteOrder, loadDash. Needs data/tracking.js and components/order-tracking.css.
 * load() resolves false when the tracking SQL is not installed yet, so the page falls back to the old list.
 */
(function () {
  'use strict';
  var T = Pcx.Tracking;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var orders = [], ships = [], items = [], sellers = {}, carriers = [], evCache = {}, open = {}, view = 'orders', filter = 'all', q = '', shipStatus = '';
  var ACTIVE = ['placed', 'processing', 'preparing', 'partially_shipped', 'shipped', 'in_transit', 'out_for_delivery', 'partially_delivered'];
  var CLOSED = ['cancelled', 'returned', 'refunded'];
  var STATUS_CHOICES = ['processing', 'preparing_shipment', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_failed', 'cancelled', 'returned', 'refunded'];
  var FILTERS = [['all', 'All'], ['attention', 'Delivery problems'], ['active', 'In progress'], ['delivered', 'Delivered'], ['closed', 'Cancelled / returned / refunded'], ['unpaid', 'Unpaid']];

  var pane = function () { return document.getElementById('oList'); };
  var bar = function () { return document.getElementById('oFilters'); };

  async function load() {
    var o = await sb.from('orders').select('id,order_number,created_at,customer_name,phone,address,total,payment_status,fulfillment_status,user_id').order('created_at', { ascending: false }).limit(300);
    if (o.error || (o.data && o.data.length && o.data[0].fulfillment_status === undefined)) return false;
    orders = o.data || [];
    var ids = orders.map(function (x) { return x.id; });
    var r = await Promise.all([
      ids.length ? sb.from('shipments').select('*').in('order_id', ids) : { data: [] },
      ids.length ? sb.from('order_items').select('id,shipment_id,order_id,name,price,qty').in('order_id', ids) : { data: [] },
      sb.from('vendors').select('id,business_name'),
      sb.from('carriers').select('*').order('sort_order')
    ]);
    if (r[0].error) return false;
    ships = r[0].data || []; items = r[1].data || []; carriers = r[3].data || [];
    sellers = {}; (r[2].data || []).forEach(function (v) { sellers[v.id] = v.business_name; });
    evCache = {};
    render();
    return true;
  }

  var shipsOf = function (id) { return ships.filter(function (s) { return s.order_id === id; }); };
  var sellerName = function (s) { return s.vendor_id ? (sellers[s.vendor_id] || 'Seller') : 'Store'; };
  function matches(o) {
    var f = o.fulfillment_status, sh = shipsOf(o.id);
    var ok = filter === 'all' ? true : filter === 'attention' ? (f === 'delivery_problem' || sh.some(function (s) { return s.status === 'delivery_failed'; }))
      : filter === 'active' ? ACTIVE.indexOf(f) >= 0 : filter === 'delivered' ? f === 'delivered' : filter === 'closed' ? CLOSED.indexOf(f) >= 0
      : filter === 'unpaid' ? (o.payment_status === 'pending' && CLOSED.indexOf(f) < 0) : true;
    if (!ok) return false;
    var t = q.trim().toLowerCase();
    return !t || (o.order_number || '').toLowerCase().indexOf(t) >= 0 || (o.customer_name || '').toLowerCase().indexOf(t) >= 0 || (o.phone || '').indexOf(t) >= 0 ||
      sh.some(function (s) { return (s.tracking_number || '').toLowerCase().indexOf(t) >= 0; });
  }

  function summary(o) {
    var sh = shipsOf(o.id), by = {};
    sh.forEach(function (s) { by[s.status] = (by[s.status] || 0) + 1; });
    return sh.length + ' shipment' + (sh.length === 1 ? '' : 's') + ': ' + Object.keys(by).map(function (k) { return by[k] + ' ' + (T.LABEL[k] || k).toLowerCase(); }).join(', ');
  }

  function chips() {
    return FILTERS.map(function (f) {
      var n = orders.filter(function (o) { var keep = filter; filter = f[0]; var m = matches(o); filter = keep; return m; }).length;
      return '<button type="button" class="abtn' + (filter === f[0] ? ' solid' : '') + '" data-f="' + f[0] + '" style="height:32px">' + f[1] + ' (' + n + ')</button>';
    }).join('');
  }

  function carrierOpts(sel) { return '<option value="">Carrier (unchanged)</option>' + carriers.map(function (c) { return '<option value="' + esc(c.code) + '"' + (c.code === sel ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join(''); }

  function historyHTML(evs, sh) {
    var tl = T.timeline(evs, sh);
    return '<details class="tk-hist" open><summary>Tracking history (' + tl.history.length + ')</summary>' + tl.history.map(function (e) {
      return '<div class="tk-hist-row"><b>' + esc(T.LABEL[e.status] || e.title) + '</b> <span class="by">' + esc(T.fmtTime(e.occurred_at)) + ' &middot; ' + esc(e.source) + '</span>' +
        (e.description ? '<br>' + esc(e.description) : '') + (e.location ? '<br>' + esc(e.location) : '') +
        (e.tracking_number ? '<br>Tracking ' + esc(e.tracking_number) + (e.carrier ? ' (' + esc(e.carrier) + ')' : '') : '') + '</div>';
    }).join('') + '</details>';
  }

  function shipHTML(o, s) {
    var its = items.filter(function (i) { return i.shipment_id === s.id; });
    var evs = evCache[o.id] || [];
    var carrier = s.carrier_name || (carriers.filter(function (c) { return c.code === s.carrier_code; })[0] || {}).name;
    return '<div class="oship" data-ship="' + s.id + '" style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:13px">' + esc(sellerName(s)) + '</b><span class="tk-pill ' + T.tone(s.status) + '">' + esc(T.LABEL[s.status] || s.status) + '</span></div>' +
      '<div class="oitems" style="margin-top:6px">' + its.map(function (i) { return esc(i.name) + ' &times; ' + esc(i.qty); }).join(', ') + '</div>' +
      (carrier || s.tracking_number ? '<div class="tk-box">' + (carrier ? '<div class="tk-kv"><span>Carrier</span><span>' + esc(carrier) + '</span></div>' : '') +
        (s.tracking_number ? '<div class="tk-kv"><span>Tracking number</span><span>' + esc(s.tracking_number) + '</span></div>' : '') +
        (s.estimated_delivery ? '<div class="tk-kv"><span>Estimated delivery</span><span>' + esc(T.fmtDay(s.estimated_delivery)) + '</span></div>' : '') + '</div>' : '') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">' +
        '<select data-f="status"><option value="">Set status...</option><option value="tracking_updated">Tracking details only</option>' + STATUS_CHOICES.map(function (x) { return '<option value="' + x + '"' + (x === s.status ? ' disabled' : '') + '>' + T.LABEL[x] + '</option>'; }).join('') + '</select>' +
        '<select data-f="carrier">' + carrierOpts(s.carrier_code) + '</select>' +
        '<input type="text" data-f="track" placeholder="Tracking number" value="' + esc(s.tracking_number || '') + '">' +
        '<input type="date" data-f="eta" value="' + esc(s.estimated_delivery || '') + '">' +
        '<input type="text" data-f="loc" placeholder="Location (optional)">' +
        '<input type="text" data-f="note" placeholder="Note for the customer">' +
      '</div><div style="margin-top:8px"><button type="button" class="abtn solid" data-a="apply" data-id="' + s.id + '">Apply change</button>' +
      ' <span style="font-size:11px;color:var(--txt3)">Recorded in the history as an admin change.</span></div>' +
      historyHTML(evs, s) + '</div>';
  }

  function orderHTML(o) {
    var isOpen = !!open[o.id], sh = shipsOf(o.id);
    var canCancel = sh.some(function (s) { return ['delivered', 'cancelled', 'returned', 'refunded'].indexOf(s.status) < 0; });
    return '<div class="oitem" data-order="' + o.id + '">' +
      '<div class="oitem-head" data-a="toggle" data-id="' + o.id + '" style="cursor:pointer"><span class="oid">#' + esc(o.order_number || o.id) + '</span><span>' +
        '<span class="tk-pill ' + T.tone(o.payment_status) + '">' + esc(T.PAY_LABEL[o.payment_status] || o.payment_status) + '</span> ' +
        '<span class="tk-pill ' + T.tone(o.fulfillment_status) + '">' + esc(T.ORDER_LABEL[o.fulfillment_status] || o.fulfillment_status) + '</span></span></div>' +
      '<div class="ocust">' + esc(o.customer_name) + '</div><div class="odet">' + esc(o.phone) + ' &middot; ' + esc(T.fmtTime(o.created_at)) + '</div>' +
      '<div class="oitems">' + esc(summary(o)) + '</div><div class="ototal">' + esc(fmt(o.total || 0)) + '</div>' +
      (isOpen ? '<div class="odet" style="margin-top:6px">' + esc(o.address) + '</div>' + sh.map(function (s) { return shipHTML(o, s); }).join('') +
        '<div class="oact" style="flex-wrap:wrap">' +
        (o.payment_status === 'pending' ? '<button type="button" class="btn-e" data-a="pay" data-id="' + o.id + '">Confirm payment</button>' : '') +
        (canCancel ? '<button type="button" class="btn-d" data-a="cancel" data-id="' + o.id + '">Cancel order</button>' : '') +
        '<button type="button" class="btn-d" data-a="delete" data-id="' + o.id + '">Delete</button></div>'
        : '<div class="oact"><button type="button" class="btn-e" data-a="toggle" data-id="' + o.id + '">Manage shipments</button></div>') + '</div>';
  }

  function shipmentsView() {
    var list = ships.filter(function (s) {
      if (shipStatus && s.status !== shipStatus) return false;
      var o = orders.filter(function (x) { return x.id === s.order_id; })[0]; var t = q.trim().toLowerCase();
      return !t || (o && ((o.order_number || '').toLowerCase().indexOf(t) >= 0 || (o.customer_name || '').toLowerCase().indexOf(t) >= 0)) || (s.tracking_number || '').toLowerCase().indexOf(t) >= 0 || sellerName(s).toLowerCase().indexOf(t) >= 0;
    }).sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); });
    return '<select data-f="shipstatus" style="width:100%;height:38px;margin-bottom:10px"><option value="">All statuses</option>' + Object.keys(T.LABEL).filter(function (k) { return k === 'order_placed' || STATUS_CHOICES.indexOf(k) >= 0; }).map(function (k) { return '<option value="' + k + '"' + (shipStatus === k ? ' selected' : '') + '>' + T.LABEL[k] + '</option>'; }).join('') + '</select>' +
      (list.length ? list.map(function (s) {
        var o = orders.filter(function (x) { return x.id === s.order_id; })[0] || {};
        return '<div class="oitem"><div class="oitem-head"><span class="oid">#' + esc(o.order_number || s.order_id) + ' &middot; ' + esc(sellerName(s)) + '</span><span class="tk-pill ' + T.tone(s.status) + '">' + esc(T.LABEL[s.status]) + '</span></div>' +
          '<div class="ocust">' + esc(o.customer_name || '') + '</div><div class="odet">' + esc(s.carrier_name || s.carrier_code || 'No carrier yet') + (s.tracking_number ? ' &middot; ' + esc(s.tracking_number) : '') + ' &middot; updated ' + esc(T.fmtTime(s.updated_at)) + '</div>' +
          '<div class="oact"><button type="button" class="btn-e" data-a="gotoorder" data-id="' + s.order_id + '">Manage</button></div></div>';
      }).join('') : '<div class="no-items"><h3>No shipments</h3></div>');
  }

  function render() {
    var count = document.getElementById('oCount'); if (count) count.textContent = orders.length + ' order' + (orders.length === 1 ? '' : 's') + ' \u00b7 ' + ships.length + ' shipment' + (ships.length === 1 ? '' : 's');
    bar().innerHTML = '<div style="display:flex;gap:8px;margin-bottom:8px"><button type="button" class="abtn' + (view === 'orders' ? ' solid' : '') + '" data-v="orders" style="flex:1">Orders</button><button type="button" class="abtn' + (view === 'shipments' ? ' solid' : '') + '" data-v="shipments" style="flex:1">Shipments</button></div>' +
      '<input type="search" id="oSearch" class="cat-search" placeholder="Search order no., customer, phone or tracking number" value="' + esc(q) + '">' +
      (view === 'orders' ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' + chips() + '</div>' : '');
    if (view === 'shipments') { pane().innerHTML = shipmentsView(); return; }
    var list = orders.filter(matches);
    pane().innerHTML = list.length ? list.map(orderHTML).join('') : '<div class="no-items"><h3>No orders here</h3><p>Nothing matches this view.</p></div>';
  }

  async function ensureEvents(id) {
    if (evCache[id]) return;
    var r = await sb.from('tracking_events').select('*').eq('order_id', id).order('occurred_at').order('id');
    evCache[id] = r.data || [];
  }

  async function refreshOrder(id) {
    var r = await Promise.all([sb.from('orders').select('id,order_number,created_at,customer_name,phone,address,total,payment_status,fulfillment_status,user_id').eq('id', id).maybeSingle(),
      sb.from('shipments').select('*').eq('order_id', id), sb.from('tracking_events').select('*').eq('order_id', id).order('occurred_at').order('id')]);
    if (r[0].data) orders = orders.map(function (o) { return o.id === id ? r[0].data : o; });
    ships = ships.filter(function (s) { return s.order_id !== id; }).concat(r[1].data || []);
    evCache[id] = r[2].data || [];
    render();
    if (typeof loadDash === 'function') loadDash();
  }

  async function guard(id, fn, okMsg) {
    try { await fn(); toast(okMsg); await refreshOrder(id); } catch (e) { toast(e.message, true); }
  }

  document.addEventListener('click', async function (ev) {
    var t = ev.target.closest ? ev.target.closest('#oFilters [data-f], #oFilters [data-v], #oList [data-a]') : null;
    if (!t) return;
    if (t.hasAttribute('data-v')) { view = t.getAttribute('data-v'); render(); return; }
    if (t.hasAttribute('data-f')) { filter = t.getAttribute('data-f'); render(); return; }
    var a = t.getAttribute('data-a'), id = Number(t.getAttribute('data-id'));
    if (a === 'toggle') { if (open[id]) delete open[id]; else { await ensureEvents(id); open[id] = true; } render(); return; }
    if (a === 'gotoorder') { view = 'orders'; filter = 'all'; q = ''; await ensureEvents(id); open[id] = true; render(); var el = document.querySelector('[data-order="' + id + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (a === 'delete') { deleteOrder(id); return; }
    if (a === 'pay') { confirm('Confirm payment', 'Mark this order as paid? The customer gets a payment confirmed notification.', function () { guard(id, function () { return T.orderEvent(sb, id, 'payment_confirmed'); }, 'Payment confirmed'); }); return; }
    if (a === 'cancel') { confirm('Cancel order', 'Cancel every open shipment in this order? The customer is told.', function () { guard(id, function () { return T.cancelOrder(sb, id, 'Cancelled by the store'); }, 'Order cancelled'); }); return; }
    if (a === 'apply') {
      var box = t.closest('[data-ship]'), g = function (f) { var e = box.querySelector('[data-f="' + f + '"]'); return e ? e.value.trim() : ''; };
      var status = g('status'); if (!status) { toast('Choose a status, or "Tracking details only"', true); return; }
      var order = orders.filter(function (o) { return shipsOf(o.id).some(function (s) { return s.id === id; }); })[0];
      var run = function () { return guard(order.id, function () { return T.updateShipment(sb, id, status, { carrier: g('carrier'), trackingNumber: g('track'), eta: g('eta') || null, location: g('loc'), note: g('note') }); }, 'Shipment updated'); };
      if (['refunded', 'returned', 'cancelled'].indexOf(status) >= 0) confirm('Change to ' + T.LABEL[status], 'This is recorded and the customer is told. Continue?', run); else run();
    }
  });
  document.addEventListener('input', function (ev) { if (ev.target.id === 'oSearch') { q = ev.target.value; var pos = ev.target.selectionStart; render(); var s = document.getElementById('oSearch'); s.focus(); s.setSelectionRange(pos, pos); } });
  document.addEventListener('change', function (ev) { if (ev.target.matches && ev.target.matches('[data-f="shipstatus"]')) { shipStatus = ev.target.value; render(); } });

  window.AdminOrders = { load: load };
})();
