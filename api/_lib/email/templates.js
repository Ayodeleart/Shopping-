// One table describes every order email; render() turns a row of it into a finished, branded message using layout.js.
// To change the wording of an email, edit its row. To add a new order event, add a row and (if it should notify)
// a branch in public.notification_copy() in the database.

const L = require('./layout');

const seller = c => (c.seller ? c.seller : c.store);

const EVENTS = {
  order_placed: {
    label: 'Order placed', tone: 'info', scope: 'order', tracking: false, cta: 'View your order',
    subject: c => `We received your ${c.store} order #${c.order.number}`,
    headline: () => 'Thanks for your order',
    intro: c => `We've received your order and let ${c.groups.length > 1 ? 'the sellers' : 'the seller'} know. You'll get an update as each part moves.`
  },
  payment_confirmed: {
    label: 'Payment confirmed', tone: 'success', scope: 'order', tracking: false, cta: 'View your order',
    subject: c => `Payment confirmed for your ${c.store} order #${c.order.number}`,
    headline: () => 'Payment confirmed',
    intro: c => `We've confirmed your payment for order #${c.order.number}.`
  },
  processing: {
    label: 'Processing', tone: 'info', scope: 'shipment', tracking: false, cta: 'View your order',
    subject: c => `Your ${c.store} order is being prepared`,
    headline: () => 'Your order is being prepared',
    intro: c => `${seller(c)} is now preparing your items.`
  },
  shipped: {
    label: 'Shipped', tone: 'info', scope: 'shipment', tracking: true, cta: 'Track order',
    subject: c => `Your ${c.store} order has shipped`,
    headline: () => 'Your order has shipped',
    intro: c => `Your order from ${seller(c)} has been shipped.`
  },
  in_transit: {
    label: 'In transit', tone: 'info', scope: 'shipment', tracking: true, cta: 'Track order',
    subject: c => `Your ${c.store} order is on the way`,
    headline: () => 'Your order is on the way',
    intro: c => `Your order from ${seller(c)} is on its way to you.`
  },
  out_for_delivery: {
    label: 'Out for delivery', tone: 'info', scope: 'shipment', tracking: true, cta: 'Track order',
    subject: c => `Your ${c.store} order is out for delivery`,
    headline: () => 'Out for delivery',
    intro: c => `Your order from ${seller(c)} is out for delivery today. Please keep your phone close.`
  },
  delivered: {
    label: 'Delivered', tone: 'success', scope: 'shipment', tracking: true, cta: 'View your order',
    subject: c => `Your ${c.store} order has been delivered`,
    headline: () => 'Your order has been delivered',
    intro: c => `Your order from ${seller(c)} has been delivered. We hope you love it.`
  },
  delivery_failed: {
    label: 'Delivery failed', tone: 'warning', scope: 'shipment', tracking: true, cta: 'View details',
    subject: c => `We couldn't deliver your ${c.store} order`,
    headline: () => "We couldn't deliver your order",
    intro: c => `The delivery of your order from ${seller(c)} was unsuccessful. Open the order to see what happened and what happens next.`
  },
  cancelled: {
    label: 'Cancelled', tone: 'danger', scope: 'shipment', tracking: false, cta: 'View your order',
    subject: c => `Your ${c.store} order was cancelled`,
    headline: () => 'Your order was cancelled',
    intro: c => `Your order from ${seller(c)} was cancelled.`
  },
  returned: {
    label: 'Returned', tone: 'warning', scope: 'shipment', tracking: true, cta: 'View your order',
    subject: c => `Your ${c.store} order was returned`,
    headline: () => 'Your order was returned',
    intro: c => `Your order from ${seller(c)} was returned to the seller.`
  },
  refunded: {
    label: 'Refunded', tone: 'success', scope: 'shipment', tracking: false, cta: 'View your order',
    subject: c => `Your ${c.store} refund has been issued`,
    headline: () => 'Your refund has been issued',
    intro: c => `A refund for your order from ${seller(c)} has been issued.`
  }
};

/* ctx: { store, siteUrl, logoUrl, currency, order:{id,number,address}, seller, groups:[{seller,items[]}],
          event:{description,location}, tracking:{number,carrier,eta,url}, prefsUrl } */
function render(status, ctx) {
  const t = EVENTS[status];
  if (!t) return null;
  const c = ctx;
  const groups = t.scope === 'shipment' && c.seller ? c.groups.filter(g => g.seller === c.seller) : c.groups;
  const shown = groups.length ? groups : c.groups;
  const orderUrl = `${c.siteUrl}/#order=${c.order.id}`;
  const addr = c.order.address ? String(c.order.address).replace(/\s+/g, ' ').slice(0, 90) : '';

  const body =
    L.badge(t.label, t.tone) + '<div style="height:12px"></div>' +
    L.heading(t.headline(c)) +
    L.paragraph(t.intro(c)) +
    (c.event && c.event.description && !['order_placed', 'payment_confirmed'].includes(status) ? L.paragraph(c.event.description, { muted: true, small: true }) : '') +
    L.metaTable([['Order', '#' + c.order.number], ['From', t.scope === 'shipment' ? c.seller : ''], ['Status', t.label],
                 ['Where', c.event && c.event.location], ['Delivering to', addr]]) +
    (t.tracking ? L.trackingCard(c.tracking) : '') +
    (shown.length ? L.itemsTable(shown, c.currency) : '') +
    L.button(orderUrl, t.cta);

  const footer = `You're receiving this because you placed order #${L.esc(c.order.number)} on ${L.esc(c.store)}. ` +
    `<a href="${L.esc(c.siteUrl)}/#notifications" style="color:${L.BRAND.color}">Manage notification settings</a>.`;
  const html = L.layout({ store: c.store, logoUrl: c.logoUrl, preheader: t.intro(c), body, footer });

  const text = L.toText([
    t.headline(c), '', t.intro(c), '',
    `Order: #${c.order.number}`, t.scope === 'shipment' && c.seller ? `From: ${c.seller}` : '', `Status: ${t.label}`,
    t.tracking && c.tracking && c.tracking.number ? `Tracking number: ${c.tracking.number}` : '',
    t.tracking && c.tracking && c.tracking.carrier ? `Carrier: ${c.tracking.carrier}` : '',
    '', ...shown.flatMap(g => [g.seller + ':', ...g.items.map(i => `  ${i.name} x ${i.qty}`)]),
    '', `${t.cta}: ${orderUrl}`
  ]);
  return { subject: t.subject(c), html, text };
}

module.exports = { EVENTS, render };
