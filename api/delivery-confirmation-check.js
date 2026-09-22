// /api/delivery-confirmation-check.js
// Runs on a schedule (see vercel.json crons). Finds ONLY the shipments whose own
// expected_delivery_at + grace period has passed and whose cooldown has cleared
// (delivery_confirmation_eligible() in migration_wallet_delivery.sql — nothing hardcoded here),
// sends each affected customer one push, and records the prompt so the cooldown applies to the
// next run. Running this twice in a row never double-sends: mark-as-prompted happens right after
// each send, and the eligibility query itself excludes anything already inside its cooldown.
//
// Auth: same pattern as /api/notify-dispatch.js — Authorization: Bearer <CRON_SECRET>.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL, CRON_SECRET, SITE_URL

const { getAdmin, siteUrlFrom } = require('./_lib/db');
const { createPush } = require('./_lib/push');

module.exports = async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

    const db = getAdmin();
    const push = createPush();
    const { data: eligible, error } = await db.rpc('delivery_confirmation_eligible', { p_limit: 200 });
    if (error) throw error;

    let sent = 0, skipped = 0;
    for (const s of eligible || []) {
      const { data: order } = await db.from('orders').select('id,order_number,address').eq('id', s.order_id).maybeSingle();
      const { data: vendor } = await db.from('vendors').select('business_name').eq('id', s.vendor_id).maybeSingle();
      const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', s.user_id).eq('role', 'buyer');

      if (subs && subs.length && push.configured) {
        const vendorName = (vendor && vendor.business_name) || 'your seller';
        const when = s.expected_delivery_at ? new Date(s.expected_delivery_at).toLocaleString('en-NG', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : 'recently';
        const payload = {
          title: 'Did your Marcato order arrive?',
          body: `Your order from ${vendorName} was expected around ${when}. Have you received it?`,
          url: `${siteUrlFrom(req)}/?confirm_delivery=${s.shipment_id}`,
          tag: `delivery-confirm-${s.shipment_id}`
        };
        for (const sub of subs) {
          const r = await push.send(sub, payload);
          if (r.dead) await db.from('push_subscriptions').delete().eq('id', sub.id);
        }
        sent++;
      } else {
        skipped++;
      }

      await db.rpc('delivery_confirmation_mark_prompted', { p_shipment_id: s.shipment_id, p_order_id: s.order_id, p_user_id: s.user_id });
    }

    return res.status(200).json({ ok: true, eligible: (eligible || []).length, sent, skipped });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
