// /api/notify-order.js
// Deploy target: Vercel (Node serverless function).
//
// Required environment variables (same project as /api/admin-vendors.js):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_CONTACT_EMAIL   e.g. mailto:you@example.com (any contact email works)
//
// This endpoint does NOT trust the caller's title/body — it looks the order up
// itself with the service-role key and builds the notification text server-side,
// so a malicious client can't use it to blast arbitrary push spam.

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const { createPush } = require('./_lib/push');
const { createEmail } = require('./_lib/email/send');
const { dispatch } = require('./_lib/dispatch');
const { siteUrlFrom } = require('./_lib/db');

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

webpush.setVapidDetails(
  process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function sendToSubscriptions(subs, payload) {
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
        JSON.stringify(payload)
      );
    } catch (err) {
      // 404/410 = subscription is dead (user uninstalled, permission revoked, etc.) — clean it up
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  }));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { type, orderId, orderItemId } = body || {};

    if (type === 'placed') {
      const { data: order, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).single();
      if (error || !order) return res.status(404).json({ error: 'Order not found' });

      // Tell the customer (push + email queued by the database for this order). Sends only what already exists, so it is safe to repeat.
      let buyer = null;
      try { buyer = await dispatch({ db: supabaseAdmin, push: createPush(), email: createEmail(), siteUrl: siteUrlFrom(req), orderId: order.id }); }
      catch (e) { console.error('buyer dispatch failed (the order itself is fine):', e.message); }

      // The staff alert goes out once per order, however many times this endpoint is called.
      const { data: claimed, error: claimErr } = await supabaseAdmin.from('orders')
        .update({ staff_notified_at: new Date().toISOString() }).eq('id', order.id).is('staff_notified_at', null).select('id');
      if (!claimErr && (!claimed || !claimed.length)) return res.status(200).json({ ok: true, staffAlreadyNotified: true, buyer });

      const { data: items } = await supabaseAdmin.from('order_items').select('vendor_id').eq('order_id', orderId);
      const vendorIds = [...new Set((items || []).map(i => i.vendor_id).filter(Boolean))];

      const { data: adminSubs } = await supabaseAdmin.from('push_subscriptions').select('*').eq('role', 'admin');
      const payload = { title: 'New order placed', body: `${order.customer_name} placed an order for ${order.total ? '₦' + Number(order.total).toLocaleString() : 'items'}.`, url: '/admin/' };
      await sendToSubscriptions(adminSubs || [], payload);

      if (vendorIds.length) {
        const { data: vendorSubs } = await supabaseAdmin.from('push_subscriptions').select('*').eq('role', 'vendor').in('user_id', vendorIds);
        await sendToSubscriptions(vendorSubs || [], { title: 'New order', body: 'You have a new order — tap to view.', url: '/vendor/' });
      }
      return res.status(200).json({ ok: true, buyer });
    }

    // Customer updates now come from the tracking system (record_tracking_event + /api/notify-dispatch).
    // Old clients that still send `status` are acknowledged and ignored, so nobody is notified twice.
    if (type === 'status') return res.status(200).json({ ok: true, skipped: 'handled by order tracking' });

    return res.status(400).json({ error: 'Unknown type' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
