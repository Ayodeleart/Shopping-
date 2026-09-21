// The notification engine's delivery side.
//
// Order events are saved first (public.record_tracking_event). A database trigger then writes the in-app notification and
// queues one delivery row per channel (push, email). This module sends what is queued, independently of the order update:
// a failed push or email is recorded on its delivery row and retried with a growing delay, and never touches the order.
//
//   const summary = await dispatch({ db, push, email, siteUrl, orderId })
//
// Duplicates are prevented in three places: events carry an idempotency key, there is one delivery row per
// (notification, channel), and claim_notification_deliveries() hands each due row to exactly one caller at a time.
// Adding a channel (SMS, WhatsApp ...) means adding a delivery row for it in the trigger and a sender here.

const { render } = require('./email/templates');
const { trackingUrl } = require('./carriers');

const MAX_AGE_MS = 48 * 60 * 60 * 1000;      // a shipping update older than two days is no longer worth a push or an email
const backoffMinutes = attempts => Math.min(180, Math.pow(2, attempts) * 2);

async function settingsMap(db) {
  const { data } = await db.from('store_settings').select('key,value');
  return Object.fromEntries((data || []).map(r => [r.key, r.value]));
}

const fmtDate = d => {
  if (!d) return '';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00Z');       // PostgREST sends dates as 'YYYY-MM-DD'
  return isNaN(dt) ? '' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

async function loadContext(db, n, settings, siteUrl) {
  const store = settings.storeName || 'Maccato';
  const [{ data: ev }, { data: order }, { data: ships }, { data: items }, { data: carriers }] = await Promise.all([
    db.from('tracking_events').select('*').eq('id', n.tracking_event_id).maybeSingle(),
    db.from('orders').select('id,order_number,address').eq('id', n.order_id).maybeSingle(),
    db.from('shipments').select('id,vendor_id,carrier_code,estimated_delivery').eq('order_id', n.order_id),
    db.from('order_items').select('shipment_id,name,qty,price').eq('order_id', n.order_id),
    db.from('carriers').select('code,name,tracking_url')
  ]);
  if (!ev || !order) return null;
  const vendorIds = [...new Set((ships || []).map(s => s.vendor_id).filter(Boolean))];
  let vendors = [];
  if (vendorIds.length) vendors = (await db.from('vendors').select('id,business_name').in('id', vendorIds)).data || [];
  const nameOf = s => (s.vendor_id && (vendors.find(v => v.id === s.vendor_id) || {}).business_name) || store;
  const groups = (ships || []).map(s => ({
    shipmentId: s.id, seller: nameOf(s),
    items: (items || []).filter(i => i.shipment_id === s.id).map(i => ({ name: i.name, qty: i.qty, price: Number(i.price) }))
  })).filter(g => g.items.length);
  const ship = (ships || []).find(s => s.id === ev.shipment_id);
  const carrier = ship && (carriers || []).find(c => c.code === ship.carrier_code);
  return {
    store, siteUrl, logoUrl: siteUrl + '/store-logo.png', currency: settings.currency || '₦',
    order: { id: order.id, number: order.order_number, address: order.address },
    seller: ship ? nameOf(ship) : null, groups, event: ev,
    tracking: ship ? { number: ev.tracking_number, carrier: ev.carrier || (carrier && carrier.name), eta: fmtDate(ship.estimated_delivery),
                       url: carrier ? trackingUrl(carrier.tracking_url, ev.tracking_number) : null } : null
  };
}

async function sendPush(db, push, n) {
  if (!push.configured) return { status: 'skipped', reason: 'push_not_configured' };
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', n.user_id).eq('role', 'buyer');
  if (!subs || !subs.length) return { status: 'skipped', reason: 'no_subscription' };
  const payload = { title: n.title, body: n.message, url: n.url || '/', tag: 'n-' + n.id, notificationId: n.id, orderId: n.order_id };
  let ok = 0, dead = 0, error = null;
  for (const s of subs) {
    const r = await push.send(s, payload, { topic: 'n' + n.id });        // `topic` lets the push service replace a repeat of the same message
    if (r.ok) {
      ok++;
      await db.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), fail_count: 0 }).eq('id', s.id);
    } else if (r.dead) {
      dead++;
      await db.from('push_subscriptions').delete().eq('id', s.id);       // uninstalled or permission revoked
    } else {
      error = r.error;
      await db.from('push_subscriptions').update({ fail_count: (s.fail_count || 0) + 1 }).eq('id', s.id);
    }
  }
  if (ok) return { status: 'sent' };
  if (dead === subs.length) return { status: 'skipped', reason: 'no_subscription' };
  return { status: 'failed', error: String(error || 'push failed').slice(0, 500) };
}

async function sendEmail(db, email, n, ctxCache) {
  if (!email.configured) return { status: 'skipped', reason: 'email_not_configured' };
  const { data: u, error: uerr } = await db.auth.admin.getUserById(n.user_id);
  const to = u && u.user && u.user.email;
  if (uerr || !to) return { status: 'skipped', reason: 'no_email' };
  const ctx = await ctxCache();
  if (!ctx) return { status: 'failed', error: 'order data missing' };
  const msg = render(ctx.event.status, ctx);
  if (!msg) return { status: 'skipped', reason: 'no_template' };
  const r = await email.send({ to, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey: `notif-${n.id}-email` });
  if (r.ok) return { status: 'sent', providerId: r.id };
  return r.retry === false ? { status: 'skipped', reason: 'rejected', error: r.error } : { status: 'failed', error: String(r.error).slice(0, 500) };
}

async function dispatch({ db, push, email, siteUrl, orderId = null, limit = 25, now = Date.now }) {
  const summary = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const { data: claimed, error } = await db.rpc('claim_notification_deliveries', { p_limit: limit, p_order: orderId });
  if (error) throw error;
  if (!claimed || !claimed.length) return summary;
  summary.claimed = claimed.length;

  const { data: notifs } = await db.from('notifications').select('*').in('id', [...new Set(claimed.map(c => c.notification_id))]);
  const byId = Object.fromEntries((notifs || []).map(n => [n.id, n]));
  const settings = await settingsMap(db);
  const ctxFor = {};

  for (const d of claimed) {
    let res;
    try {
      const n = byId[d.notification_id];
      if (!n) res = { status: 'skipped', reason: 'notification_missing' };
      else if (now() - new Date(n.created_at).getTime() > MAX_AGE_MS) res = { status: 'skipped', reason: 'expired' };
      else if (d.channel === 'push') res = await sendPush(db, push, n);
      else if (d.channel === 'email') {
        res = await sendEmail(db, email, n, async () => (ctxFor[n.id] = ctxFor[n.id] || (await loadContext(db, n, settings, siteUrl))));
      } else res = { status: 'skipped', reason: 'unsupported_channel' };
    } catch (e) {
      res = { status: 'failed', error: String((e && e.message) || e).slice(0, 500) };
    }
    const patch = { status: res.status, last_error: res.error || null, skipped_reason: res.reason || null, provider_id: res.providerId || null,
                    sent_at: res.status === 'sent' ? new Date(now()).toISOString() : null, updated_at: new Date(now()).toISOString() };
    if (res.status === 'failed') patch.next_attempt_at = new Date(now() + backoffMinutes(d.attempts) * 60000).toISOString();
    try { await db.from('notification_deliveries').update(patch).eq('id', d.delivery_id); } catch (_) { /* result logging must never throw */ }
    summary[res.status] = (summary[res.status] || 0) + 1;
  }
  return summary;
}

module.exports = { dispatch, loadContext, MAX_AGE_MS };
