/* Pcx.Tracking: shared order tracking helpers for the storefront, the vendor board and the admin panel.
 *
 * The truth lives in the database: `shipments` (one per seller per order, current status) and `tracking_events`
 * (append-only history). Nothing here decides a status; the client only asks (rpc record_tracking_event) and the
 * server validates. The timeline is built from real events, never from a fixed script.
 *
 *   Pcx.Tracking.loadOrder(sb, orderId)         -> { order, shipments, items, events, carriers, sellers }
 *   Pcx.Tracking.timeline(events, shipment)     -> { rows: [{ key, label, state, at, event }], history: [events newest first] }
 *   Pcx.Tracking.updateShipment(sb, id, status, { note, carrier, carrierName, trackingNumber, location, eta })
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  var LIFE = ['order_placed', 'processing', 'preparing_shipment', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];
  var STEPS = ['order_placed', 'payment_confirmed', 'processing', 'preparing_shipment', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];
  var ENDED = ['cancelled', 'returned', 'refunded'];

  var LABEL = {
    order_placed: 'Order placed', payment_confirmed: 'Payment confirmed', processing: 'Processing', preparing_shipment: 'Preparing shipment',
    shipped: 'Shipped', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
    delivery_failed: 'Delivery failed', returned: 'Returned', refunded: 'Refunded', tracking_updated: 'Tracking details updated', note: 'Note'
  };
  var ORDER_LABEL = {
    placed: 'Order placed', processing: 'Processing', preparing: 'Preparing shipment', partially_shipped: 'Partially shipped', shipped: 'Shipped',
    in_transit: 'In transit', out_for_delivery: 'Out for delivery', partially_delivered: 'Partially delivered', delivered: 'Delivered',
    delivery_problem: 'Delivery problem', cancelled: 'Cancelled', returned: 'Returned', refunded: 'Refunded'
  };
  var PAY_LABEL = { pending: 'Payment pending', paid: 'Paid', failed: 'Payment failed', refunded: 'Refunded', partially_refunded: 'Partially refunded' };

  function tone(status) {
    if (['delivered', 'refunded', 'paid'].indexOf(status) >= 0) return 'good';
    if (['cancelled', 'returned', 'failed'].indexOf(status) >= 0) return 'bad';
    if (['delivery_failed', 'delivery_problem'].indexOf(status) >= 0) return 'warn';
    if (['shipped', 'in_transit', 'out_for_delivery', 'partially_shipped', 'partially_delivered'].indexOf(status) >= 0) return 'go';
    return 'idle';
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function fmtDay(v) {
    if (!v) return '';
    var d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* Events for one shipment: order-level ones (payment, order placed) plus its own. Every step is derived from them. */
  function timeline(events, shipment) {
    var mine = (events || []).filter(function (e) { return e.shipment_id == null || e.shipment_id === shipment.id; })
      .sort(function (a, b) { return (new Date(a.occurred_at) - new Date(b.occurred_at)) || (a.id - b.id); });
    var first = {};
    mine.forEach(function (e) { if (!first[e.status]) first[e.status] = e; });
    var cur = shipment.status;
    var ended = ENDED.indexOf(cur) >= 0;
    var reached = LIFE.indexOf(cur);                           // the shipment's own status is the truth about where it is
    if (reached < 0) {                                         // failed / cancelled / returned / refunded: furthest step it actually reached
      LIFE.forEach(function (s, i) { if (first[s]) reached = Math.max(reached, i); });
      if (reached < 0) reached = 0;
    }

    var rows = STEPS.map(function (s) {
      var ev = first[s], state;
      if (s === 'payment_confirmed') state = ev ? 'done' : 'todo';
      else {
        var i = LIFE.indexOf(s);
        state = i < reached ? 'done' : i === reached ? (cur === s && s !== 'delivered' ? 'current' : 'done') : 'todo';
      }
      return { key: s, label: LABEL[s], state: state, at: ev ? ev.occurred_at : null, event: ev || null };
    });

    var extras = mine.filter(function (e) { return ['delivery_failed'].concat(ENDED).indexOf(e.status) >= 0; })
      .map(function (e) { return { key: e.status + e.id, label: LABEL[e.status], state: 'problem', at: e.occurred_at, event: e }; });

    if (ended) {
      rows = rows.filter(function (r) { return r.state !== 'todo' && r.state !== 'current' ? true : false; })
        .map(function (r) { return r.state === 'current' ? Object.assign({}, r, { state: 'done' }) : r; }).concat(extras);
    } else if (cur === 'delivery_failed') {
      rows = rows.map(function (r) { return r.state === 'current' ? Object.assign({}, r, { state: 'done' }) : r; });
      var at = 0;
      rows.forEach(function (r, i) { if (r.state === 'done') at = i; });
      rows.splice.apply(rows, [at + 1, 0].concat(extras.slice(-1)));
    }
    var history = mine.slice().reverse();
    return { rows: rows, history: history };
  }

  function overallEstimate(shipments) {
    var d = (shipments || []).filter(function (s) { return s.estimated_delivery && ENDED.concat(['delivered']).indexOf(s.status) < 0; })
      .map(function (s) { return s.estimated_delivery; }).sort();
    return d.length ? d[d.length - 1] : null;      // the last shipment decides when the whole order is complete
  }

  function trackingUrl(carriers, code, number) {
    var c = (carriers || []).filter(function (x) { return x.code === code; })[0];
    return c && c.tracking_url && number ? c.tracking_url.replace('{n}', encodeURIComponent(number)) : null;
  }

  function cleanError(msg) {
    return String(msg || 'Something went wrong').replace(/^.*?ERROR:\s*/, '').replace(/\s*\(SQLSTATE.*$/, '');
  }

  async function loadOrder(sb, orderId) {
    var r = await Promise.all([
      sb.from('orders').select('id,order_number,created_at,customer_name,phone,address,total,items,payment_status,fulfillment_status').eq('id', orderId).maybeSingle(),
      sb.from('shipments').select('*').eq('order_id', orderId).order('id'),
      sb.from('order_items').select('id,shipment_id,product_id,name,price,qty').eq('order_id', orderId),
      sb.from('tracking_events').select('*').eq('order_id', orderId).order('occurred_at').order('id'),
      sb.from('carriers').select('*').order('sort_order')
    ]);
    if (r[0].error) throw r[0].error;
    var ids = [];
    (r[1].data || []).forEach(function (s) { if (s.vendor_id && ids.indexOf(s.vendor_id) < 0) ids.push(s.vendor_id); });
    var sellers = {};
    if (ids.length) {
      var v = await sb.from('vendors').select('id,business_name,logo_url').in('id', ids);
      (v.data || []).forEach(function (x) { sellers[x.id] = x; });
    }
    return { order: r[0].data, shipments: r[1].data || [], items: r[2].data || [], events: r[3].data || [], carriers: r[4].data || [], sellers: sellers };
  }

  function uuid() {
    return (global.crypto && global.crypto.randomUUID) ? global.crypto.randomUUID() : 'k' + Date.now() + Math.random().toString(36).slice(2);
  }

  /* Ask the server to move a shipment. It decides whether that is allowed, records the event and queues notifications.
     A repeated tap sends the same status again, which the server ignores. Then we nudge the dispatcher; if that call
     fails nothing is lost, the queued push/email is retried by the next dispatch. */
  async function updateShipment(sb, shipmentId, status, o) {
    o = o || {};
    var r = await sb.rpc('record_tracking_event', {
      p_shipment_id: shipmentId, p_status: status, p_note: o.note || null, p_carrier: o.carrier || null, p_carrier_name: o.carrierName || null,
      p_tracking_number: o.trackingNumber || null, p_location: o.location || null, p_estimated_delivery: o.eta || null,
      p_metadata: {}, p_idempotency_key: uuid()
    });
    if (r.error) throw new Error(cleanError(r.error.message));
    dispatchSoon(sb);
    return r.data;
  }

  async function orderEvent(sb, orderId, status, note) {
    var r = await sb.rpc('record_order_event', { p_order_id: orderId, p_status: status, p_note: note || null, p_idempotency_key: null });
    if (r.error) throw new Error(cleanError(r.error.message));
    dispatchSoon(sb);
    return r.data;
  }

  async function cancelOrder(sb, orderId, reason) {
    var r = await sb.rpc('cancel_order', { p_order_id: orderId, p_reason: reason || null });
    if (r.error) throw new Error(cleanError(r.error.message));
    dispatchSoon(sb);
    return r.data;
  }

  function dispatchSoon(sb) {
    sb.auth.getSession().then(function (s) {
      var t = s && s.data && s.data.session && s.data.session.access_token;
      if (!t) return;
      fetch('/api/notify-dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: '{}' }).catch(function () {});
    }).catch(function () {});
  }

  Pcx.Tracking = {
    LIFE: LIFE, STEPS: STEPS, LABEL: LABEL, ORDER_LABEL: ORDER_LABEL, PAY_LABEL: PAY_LABEL,
    tone: tone, fmtTime: fmtTime, fmtDay: fmtDay, timeline: timeline, overallEstimate: overallEstimate, trackingUrl: trackingUrl,
    cleanError: cleanError, loadOrder: loadOrder, updateShipment: updateShipment, orderEvent: orderEvent, cancelOrder: cancelOrder, dispatchSoon: dispatchSoon
  };
})(window);
