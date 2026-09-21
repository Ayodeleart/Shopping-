const { createClient } = require('@supabase/supabase-js');
let admin;
// service-role client: bypasses row level security, so it only ever runs on the server
function getAdmin() {
  if (!admin) admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return admin;
}
function siteUrlFrom(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
  return host ? 'https://' + host : '';
}
module.exports = { getAdmin, siteUrlFrom };
