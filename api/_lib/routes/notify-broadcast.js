// /api/notify-broadcast.js
// Admin-only broadcast push (the "Announcements" tab in admin/index.html).
// Same env vars as /api/notify-order.js, plus ADMIN_EMAIL (already set for /api/admin-vendors.js).

const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

webpush.setVapidDetails(
  process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

function getAdminEmails() {
  return (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });
    if (!getAdminEmails().includes((user.email || '').toLowerCase())) {
      return res.status(403).json({ error: 'Not an admin account' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { title, message, url, target } = body || {};
    if (!title || !message) return res.status(400).json({ error: 'title and message are required' });

    let roles = ['buyer'];
    if (target === 'vendors') roles = ['vendor'];
    if (target === 'all') roles = ['buyer', 'vendor'];

    let { data: subs, error } = await supabaseAdmin.from('push_subscriptions').select('*').in('role', roles);
    if (error) throw error;
    // Promotional messages respect each customer's choice. (Order, delivery and payment updates never go through here.)
    const { data: optedOut } = await supabaseAdmin.from('notification_preferences').select('user_id').eq('promotional', false);
    if (optedOut && optedOut.length) { const off = new Set(optedOut.map(r => r.user_id)); subs = (subs || []).filter(s => !off.has(s.user_id)); }

    const payload = { title, body: message, url: url || '/' };
    let sent = 0, dead = 0;
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', s.id);
          dead++;
        }
      }
    }));

    return res.status(200).json({ ok: true, sent, dead, totalTargeted: (subs || []).length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
