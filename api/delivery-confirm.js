// /api/delivery-confirm.js
// Customer taps "Yes, I received it" / "Not yet". Ownership and eligibility are re-checked inside
// delivery_confirm() in the database — this endpoint never sets shipment/order status itself and
// never trusts a shipment/order id from the client without verifying it belongs to the caller.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { getAdmin } = require('./_lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const db = getAdmin();
    const { data: { user }, error: userErr } = await db.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const shipmentId = Number(body.shipmentId);
    const response = body.response;
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) return res.status(400).json({ error: 'shipmentId required' });
    if (!['yes', 'not_yet'].includes(response)) return res.status(400).json({ error: 'response must be yes or not_yet' });

    const { data, error } = await db.rpc('delivery_confirm', { p_shipment_id: shipmentId, p_user_id: user.id, p_response: response });
    if (error) return res.status(400).json({ error: error.message });

    return res.status(200).json({ ok: true, shipment: data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
