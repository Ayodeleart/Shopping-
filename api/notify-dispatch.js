// /api/notify-dispatch.js
// Sends the push notifications and emails that the database has queued for order updates.
//
// Called (a) by the storefront, vendor board and admin panel right after an order update, with the signed-in user's token,
// and (b) optionally by a scheduler (Authorization: Bearer CRON_SECRET) to retry anything that failed.
// It takes no message text from the caller: it only sends rows that already exist in notification_deliveries, and every
// row is sent at most once at a time, so calling it repeatedly is harmless.
//
// Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL (push),
// RESEND_API_KEY + EMAIL_FROM (email), SITE_URL (links + logo in emails; defaults to the request host), CRON_SECRET (optional).

const { getAdmin, siteUrlFrom } = require('./_lib/db');
const { createPush } = require('./_lib/push');
const { createEmail } = require('./_lib/email/send');
const { dispatch } = require('./_lib/dispatch');

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const db = getAdmin();
    const isCron = !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
    if (!isCron) {
      const { data: { user }, error } = await db.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Invalid session' });
    }
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
    const orderId = Number.isInteger(Number(body.orderId)) && Number(body.orderId) > 0 ? Number(body.orderId) : null;

    const summary = await dispatch({ db, push: createPush(), email: createEmail(), siteUrl: siteUrlFrom(req), orderId });
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
