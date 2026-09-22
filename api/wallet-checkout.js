// /api/wallet-checkout.js
// Applies wallet balance to an existing order. Amount and success are always derived server-side
// (via wallet_debit_for_order, which locks the wallet row and re-checks balance) — the frontend
// only says which order and how much of the wallet it wants to use; it can never set a balance.
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
    const orderId = Number(body.orderId);
    const amount = Number(body.amount);
    if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'orderId required' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be positive' });

    const { data, error } = await db.rpc('wallet_debit_for_order', { p_user_id: user.id, p_order_id: orderId, p_amount: amount });
    if (error) return res.status(400).json({ error: error.message });

    const { data: order } = await db.from('orders').select('id,total,wallet_paid,payment_status').eq('id', orderId).single();
    const { data: wallet } = await db.from('customer_wallets').select('available_balance').eq('user_id', user.id).single();

    return res.status(200).json({ ok: true, transaction: data, order, wallet_balance: wallet ? wallet.available_balance : 0 });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
