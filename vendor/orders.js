/* Vendor board: fulfilment. One card per shipment (this seller's part of an order), with the next actions for its status.
 *
 * Every button asks the server to record a tracking event (rpc record_tracking_event). The server checks that this
 * shipment belongs to this seller, that the move is allowed, and creates the history entry and the customer's notifications.
 * Sellers can never touch payment, refund or another seller's shipment: the database refuses, whatever this page sends.
 *
 * Uses page globals: sb, session, toast, loadDash. Needs data/tracking.js and components/order-tracking.css.
 * load() resolves false when the tracking SQL is not installed yet, so the page can fall back to the old list.
 */
(function () {
  'use strict';
  var T = Pcx.Tracking;
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ships = [], items = [], events = [], carriers = [], openForm = {}, busy = false;
  var list = function () { return document.getElementById('ordList'); };

  var ACTIONS = {
    order_placed:       [['processing', 'Start processing', 'p']],
    processing:         [['preparing_shipment', 'Preparing shipment', 'p'], ['shipform', 'Ship now', ''], ['cancelled', 'Cancel', 'd']],
    preparing_shipment: [['shipform', 'Add tracking and ship', 'p'], ['cancelled', 'Cancel', 'd']],
    shipped:            [['in_transit', 'In transit', ''], ['out_for_delivery', 'Out for delivery', ''], ['delivered', 'Delivered', 'p'], ['delivery_failed', 'Delivery failed', 'd'], ['editform', 'Edit tracking', '']],
    in_transit:         [['out_for_delivery', 'Out for delivery', ''], ['delivered', 'Delivered', 'p'], ['delivery_failed', 'Delivery failed', 'd'], ['editform', 'Edit tracking', '']],
    out_for_delivery:   [['delivered', 'Delivered', 'p'], ['delivery_failed', 'Delivery failed', 'd'], ['editform', 'Edit tracking', '']],
    delivery_failed:    [['out_for_delivery', 'Try delivery again', 'p'], ['delivered', 'Delivered', ''], ['editform', 'Edit tracking', '']]
  };

  async function load() {
    var uid = session.user.id;
    /* The seller never reads the parent `orders` row (it holds the whole cart, other sellers' products included).
       The database view `seller_shipments` returns only this seller's shipments plus the delivery details needed to fulfil them,
       and `order_items` returns only this seller's own lines. */
    var r = await Promise.all([
      sb.from('seller_shipments').select('*').order('created_at', { ascending: false }),
      sb.from('order_items').select('*').eq('vendor_id', uid),
      sb.from('carriers').select('*').eq('is_active', true).order('sort_order')
    ]);
    if (r[0].error) {
      /* the seller-privacy SQL has not been run yet: use the previous query so fulfilment keeps working meanwhile */
      r[0] = await sb.from('shipments').select('*, orders(order_number, customer_name, phone, address, created_at, payment_status)').eq('vendor_id', uid).order('created_at', { ascending: false });
      if (r[0].error) return false;
    } else {
      r[0].data = (r[0].data || []).map(function (v) {
        return Object.assign({}, v, { orders: { order_number: v.order_number, customer_name: v.customer_name, phone: v.phone, address: v.address, created_at: v.order_created_at, payment_status: v.payment_status } });
      });
    }
    ships = r[0].data || []; items = r[1].data || []; carriers = r[2].data || [];
    var orderIds = ships.map(function (s) { return s.order_id; });
    events = orderIds.length ? ((await sb.from('tracking_events').select('*').in('order_id', orderIds)).data || []) : [];
    render();
    return true;
  }

  function carrierOptions(sel) {
    return '<option value="">Choose carrier</option>' + carriers.map(function (c) {
      return '<option value="' + esc(c.code) + '" data-provider="' + esc(c.provider) + '"' + (sel === c.code ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
  }

  function formHTML(s) {
    var edit = openForm[s.id] === 'edit', own = (carriers.filter(function (c) { return c.code === s.carrier_code; })[0] || {}).provider === 'own';
    return '<div class="shipForm" data-form="' + esc(s.id) + '" style="background:var(--bg2);border-radius:10px;padding:10px;margin-top:10px">' +
      '<div class="fld"><label>Carrier</label><select data-f="carrier">' + carrierOptions(s.carrier_code) + '</select></div>' +
      '<div class="fld" data-w="cname" style="display:' + (s.carrier_code === 'other' ? '' : 'none') + '"><label>Courier name</label><input type="text" data-f="cname" maxlength="60" value="' + esc(s.carrier_name || '') + '"></div>' +
      '<div class="fld" data-w="track" style="display:' + (own ? 'none' : '') + '"><label>Tracking number</label><input type="text" data-f="track" maxlength="60" placeholder="From the carrier" value="' + esc(s.tracking_number || '') + '"></div>' +
      '<div class="ad-hint" data-w="owninfo" style="font-size:12px;color:var(--txt3);margin:-4px 0 10px;display:' + (own ? '' : 'none') + '">Marketplace delivery: a tracking number is created for you when you ship.</div>' +
      '<div class="fld"><label>Estimated delivery</label><select data-f="etaOption">' +
        '<option value="">Choose an estimate</option>' +
        '<option value="within_1h">Within 1 hour</option>' +
        '<option value="1_2h">1&ndash;2 hours</option>' +
        '<option value="2_4h">2&ndash;4 hours</option>' +
        '<option value="same_day">Same day</option>' +
        '<option value="tomorrow">Tomorrow</option>' +
        '<option value="custom">Custom date/time</option>' +
      '</select></div>' +
      '<div class="fld" data-w="etaCustom" style="display:none"><label>Custom delivery date/time</label><input type="datetime-local" data-f="etaCustom"></div>' +
      '<div class="fld"><label>Note for the customer (optional)</label><input type="text" data-f="note" maxlength="200"></div>' +
      '<div class="shipBtns"><button type="button" class="sbtn p" data-a="' + (edit ? 'saveedit' : 'ship') + '" data-id="' + esc(s.id) + '">' + (edit ? 'Save tracking' : 'Mark as shipped') + '</button>' +
      '<button type="button" class="sbtn" data-a="closeform" data-id="' + esc(s.id) + '">Cancel</button></div></div>';
  }

  function cardHTML(s) {
    var o = s.orders || {}, its = items.filter(function (i) { return i.shipment_id === s.id; });
    var tl = T.timeline(events.filter(function (e) { return e.order_id === s.order_id; }), s);
    var acts = ACTIONS[s.status] || [];
    var total = its.reduce(function (n, i) { return n + i.price * i.qty; }, 0);
    var carrier = s.carrier_name || (carriers.filter(function (c) { return c.code === s.carrier_code; })[0] || {}).name;
    var link = T.trackingUrl(carriers, s.carrier_code, s.tracking_number);
    return '<div class="ordCard" data-ship="' + esc(s.id) + '">' +
      '<div class="ordTop"><div><div class="ordName">#' + esc(o.order_number || s.order_id) + ' &middot; ' + esc(o.customer_name || 'Customer') + '</div>' +
      '<div class="ordDate" style="font-size:11px;color:var(--txt3)">' + esc(T.fmtTime(o.created_at || s.created_at)) + '</div></div>' +
      '<span class="tk-pill ' + esc(T.tone(s.status)) + '">' + esc(T.LABEL[s.status] || s.status) + '</span></div>' +
      its.map(function (i) { return '<div class="ordLine"><span>' + esc(i.name) + ' &times; ' + esc(i.qty) + '</span><span>&#8358;' + Number(i.price * i.qty).toLocaleString() + '</span></div>'; }).join('') +
      '<div class="ordLine" style="font-weight:800;color:var(--txt)"><span>Your part of this order</span><span>&#8358;' + Number(total).toLocaleString() + '</span></div>' +
      '<div style="font-size:11.5px;color:var(--txt3);margin-top:6px;line-height:1.5">Deliver to: ' + esc(o.address || '') + (o.phone ? ' &middot; ' + esc(o.phone) : '') + '</div>' +
      (s.tracking_number || carrier ? '<div class="tk-box">' + (carrier ? '<div class="tk-kv"><span>Carrier</span><span>' + esc(carrier) + '</span></div>' : '') +
        (s.tracking_number ? '<div class="tk-kv"><span>Tracking number</span><span>' + esc(s.tracking_number) + '</span></div>' : '') +
        (s.estimated_delivery ? '<div class="tk-kv"><span>Estimated delivery</span><span>' + esc(T.fmtDay(s.estimated_delivery)) + '</span></div>' : '') +
        (link ? '<a class="tk-link" href="' + safeUrl(link) + '" target="_blank" rel="noopener noreferrer">Track with carrier &rarr;</a>' : '') + '</div>' : '') +
      (acts.length ? '<div class="fld" style="margin:10px 0 0"><input type="text" data-note="' + esc(s.id) + '" maxlength="200" placeholder="Note or location for the customer (optional)" style="min-height:38px;font-size:13px"></div>' +
        '<div class="shipBtns">' + acts.map(function (a) { return '<button type="button" class="sbtn ' + esc(a[2]) + '" data-a="' + esc(a[0]) + '" data-id="' + esc(s.id) + '">' + esc(a[1]) + '</button>'; }).join('') + '</div>'
        : '<div style="font-size:12px;color:var(--txt3);margin-top:10px">This shipment is ' + esc((T.LABEL[s.status] || s.status).toLowerCase()) + '. Contact the store admin if something needs to change.</div>') +
      (openForm[s.id] ? formHTML(s) : '') +
      '<details class="tk-hist"><summary>Tracking history (' + tl.history.length + ')</summary><ul class="tl" style="margin-top:10px">' + tl.rows.map(function (r) {
        return '<li class="' + esc(r.state) + '"><span class="tl-dot">' + (r.state === 'done' ? '&#10003;' : r.state === 'problem' ? '!' : '') + '</span><div class="tl-body"><div class="tl-lbl">' + esc(r.label) + '</div>' +
          (r.at ? '<div class="tl-at">' + esc(T.fmtTime(r.at)) + '</div>' : '') + '</div></li>'; }).join('') + '</ul></details></div>';
  }

  function render() {
    var el = list();
    if (!ships.length) { el.innerHTML = '<div class="empty">No orders yet.</div>'; return; }
    el.innerHTML = ships.map(cardHTML).join('');
  }

  function fv(card, f) { var e = card.querySelector('[data-f="' + f + '"]'); return e ? e.value.trim() : ''; }

  var ETA_HOURS = { within_1h: 1, '1_2h': 2, '2_4h': 4, same_day: 8, tomorrow: 24 };
  /* Converts the vendor's relative pick into an absolute timestamp NOW, client-side, purely so the
     form can show/send something concrete — the server independently re-derives eligibility off this
     same estimated_delivery value later, it never trusts the vendor's clock for anything else. */
  function etaFromForm(card) {
    var opt = fv(card, 'etaOption');
    if (!opt) return null;
    if (opt === 'custom') { var v = fv(card, 'etaCustom'); return v ? new Date(v).toISOString() : null; }
    var hrs = ETA_HOURS[opt];
    return hrs ? new Date(Date.now() + hrs * 3600000).toISOString() : null;
  }

  async function run(id, status, opts) {
    if (busy) return;
    busy = true;
    var btns = list().querySelectorAll('button'); btns.forEach(function (b) { b.disabled = true; });
    try {
      await T.updateShipment(sb, id, status, opts);
      toast('Updated. The customer has been notified.');
      delete openForm[id];
      await load(); if (typeof loadDash === 'function') loadDash();
    } catch (e) {
      toast(e.message, true);
      btns.forEach(function (b) { b.disabled = false; });
    } finally { busy = false; }
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('#ordList [data-a]') : null;
    if (!b) return;
    var a = b.getAttribute('data-a'), id = Number(b.getAttribute('data-id')), card = b.closest('[data-ship]');
    var noteEl = card && card.querySelector('[data-note="' + id + '"]'), note = noteEl ? noteEl.value.trim() : '';
    if (a === 'shipform') { openForm[id] = 'ship'; render(); return; }
    if (a === 'editform') { openForm[id] = 'edit'; render(); return; }
    if (a === 'closeform') { delete openForm[id]; render(); return; }
    if (a === 'ship' || a === 'saveedit') {
      var opts = { carrier: fv(card, 'carrier'), carrierName: fv(card, 'cname'), trackingNumber: fv(card, 'track'), eta: etaFromForm(card), note: fv(card, 'note') };
      if (!opts.carrier) { toast('Choose the carrier', true); return; }
      if (fv(card, 'etaOption') === 'custom' && !opts.eta) { toast('Choose the custom delivery date/time', true); return; }
      run(id, a === 'ship' ? 'shipped' : 'tracking_updated', opts);
      return;
    }
    if (a === 'cancelled' && !window.confirm('Cancel this shipment? The customer will be told.')) return;
    run(id, a, { note: note });
  });

  document.addEventListener('change', function (ev) {
    var sel = ev.target;
    if (sel.matches && sel.matches('#ordList select[data-f="carrier"]')) {
      var card = sel.closest('.shipForm'), opt = sel.options[sel.selectedIndex], own = opt && opt.getAttribute('data-provider') === 'own';
      card.querySelector('[data-w="cname"]').style.display = sel.value === 'other' ? '' : 'none';
      card.querySelector('[data-w="track"]').style.display = own ? 'none' : '';
      card.querySelector('[data-w="owninfo"]').style.display = own ? '' : 'none';
      return;
    }
    if (sel.matches && sel.matches('#ordList select[data-f="etaOption"]')) {
      var card2 = sel.closest('.shipForm');
      card2.querySelector('[data-w="etaCustom"]').style.display = sel.value === 'custom' ? '' : 'none';
    }
  });

  window.VendorOrders = { load: load };
})();
