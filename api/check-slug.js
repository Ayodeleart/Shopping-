// /api/check-slug.js
// Checks store-slug availability during the "Create your store" step.
// A plain client-side query can't do this because RLS only lets a vendor
// read their own row or other *approved* vendors' rows — a slug clash with
// a still-pending applicant wouldn't be caught otherwise.

const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { slug, excludeVendorId } = body || {};
    if (!slug) return res.status(400).json({ error: 'slug is required' });

    let query = supabaseAdmin.from('vendors').select('id').eq('store_slug', slug);
    if (excludeVendorId) query = query.neq('id', excludeVendorId);
    const { data, error } = await query.maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;

    return res.status(200).json({ available: !data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
