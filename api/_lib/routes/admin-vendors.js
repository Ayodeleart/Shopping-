// /api/admin-vendors.js
// Deploy target: Vercel (or any host that runs Node serverless functions).
//
// Required environment variables (set in your Vercel project settings, NOT in the repo):
//   SUPABASE_URL               = https://qmwlphribvncdtgzbixt.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  = (Project Settings -> API -> service_role key, in Supabase dashboard)
//   ADMIN_EMAIL                = comma-separated list, e.g. "you@gmail.com,partner@gmail.com"
//
// This is the ONLY place the service-role key should ever exist. Never put it in
// index.html / admin/index.html / vendor/index.html — those stay on the anon key.

const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getAdminEmails() {
  return (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

module.exports = async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });

    // Verify the caller's Google-auth session token and confirm they're an admin
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const adminEmails = getAdminEmails();
    if (!adminEmails.includes((user.email || '').toLowerCase())) {
      return res.status(403).json({ error: 'Not an admin account' });
    }

    if (req.method === 'GET') {
      const { data, error } = await supabaseAdmin.from('vendors').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      // Application history / audit trail (vendor_events, added by migration_vendor_center.sql).
      // Tolerate a missing table so the vendors list keeps working before the migration is run.
      let events = [];
      try {
        const ev = await supabaseAdmin.from('vendor_events').select('*').order('created_at', { ascending: false }).limit(500);
        if (!ev.error && Array.isArray(ev.data)) events = ev.data;
      } catch (e) { /* table not created yet */ }
      return res.status(200).json({ vendors: data, events });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { vendor_id, status, reason } = body || {};
      if (!vendor_id || !['approved', 'suspended', 'pending', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'vendor_id and a valid status are required' });
      }
      const patch = { status: status === 'rejected' ? 'pending' : status };
      if (status === 'approved') { patch.approved_at = new Date().toISOString(); patch.application_status = 'approved'; patch.rejection_reason = null; }
      if (status === 'rejected') { patch.application_status = 'rejected'; patch.rejection_reason = reason || 'Please review and resubmit your application.'; }
      if (status === 'suspended') { patch.application_status = 'suspended'; }
      if (status === 'pending') { patch.application_status = 'pending_review'; patch.rejection_reason = null; }
      const { error } = await supabaseAdmin.from('vendors').update(patch).eq('id', vendor_id);
      if (error) throw error;
      // Record the decision in the audit trail (best effort — the decision itself already succeeded).
      try {
        await supabaseAdmin.from('vendor_events').insert([{
          vendor_id,
          actor: 'admin',
          actor_id: user.id,
          type: 'status_change',
          note: (status === 'rejected' ? 'Changes requested' : status.charAt(0).toUpperCase() + status.slice(1)) +
                (reason ? ' — ' + String(reason).slice(0, 800) : '') + ' (by ' + (user.email || 'admin') + ')'
        }]);
      } catch (e) { /* vendor_events not created yet */ }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
