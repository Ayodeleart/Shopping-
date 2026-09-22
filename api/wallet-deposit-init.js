// /api/wallet-deposit-init.js
// Starts a REAL Paystack transaction for a wallet top-up. Never credits anything itself —
// only wallet-deposit-webhook.js (after independent server-side verification with Paystack)
// is allowed to credit the wallet. See migration_wallet_delivery.sql: wallet_credit_deposit().
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY, SITE_URL

const { getAdmin, siteUrlFrom } = require('./_lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: 'Payments are not configured yet (PAYSTACK_SECRET_KEY missing)' });

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const db = getAdmin();
    const { data: { user }, error: userErr } = await db.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 100) return res.status(400).json({ error: 'Minimum deposit is ₦100' });

    const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(amount * 100),   // kobo
        currency: 'NGN',
        callback_url: `${siteUrlFrom(req)}/?wallet_deposit=pending`,
        metadata: { user_id: user.id, purpose: 'wallet_deposit' }
      })
    });
    const psData = await psRes.json();
    if (!psRes.ok || !psData.status) return res.status(502).json({ error: psData.message || 'Could not start payment' });

    return res.status(200).json({ authorization_url: psData.data.authorization_url, reference: psData.data.reference });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
