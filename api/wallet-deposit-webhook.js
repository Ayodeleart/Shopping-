// /api/wallet-deposit-webhook.js
// Paystack webhook receiver for wallet deposits.
//
// SECURITY: the webhook payload itself is never trusted for the amount/status. We verify the
// signature, then independently call Paystack's Verify Transaction endpoint (server-to-server)
// before crediting anything. Crediting goes through wallet_credit_deposit(), which is idempotent
// on provider_reference — Paystack retries the same webhook on any non-2xx response, and a
// duplicate delivery must never credit twice.
//
// Configure this URL in the Paystack Dashboard -> Settings -> API Keys & Webhooks.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY

const crypto = require('crypto');
const { getAdmin } = require('./_lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: 'Not configured' });

    // req.body must be the raw string here for signature verification to be correct;
    // Vercel gives parsed JSON by default for application/json, so re-stringify consistently.
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.headers['x-paystack-signature'];
    const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
    if (!signature || signature !== expected) return res.status(401).json({ error: 'Invalid signature' });

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (event.event !== 'charge.success') return res.status(200).json({ ok: true, ignored: true });

    const reference = event.data && event.data.reference;
    if (!reference) return res.status(400).json({ error: 'Missing reference' });

    // Independent server-side verification — never trust the webhook body's amount/status alone.
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const verify = await verifyRes.json();
    if (!verifyRes.ok || !verify.status || !verify.data || verify.data.status !== 'success') {
      return res.status(200).json({ ok: true, skipped: 'not a verified successful charge' });
    }

    const meta = verify.data.metadata || {};
    if (meta.purpose !== 'wallet_deposit' || !meta.user_id) {
      return res.status(200).json({ ok: true, skipped: 'not a wallet deposit transaction' });
    }

    const amount = verify.data.amount / 100; // kobo -> naira
    const db = getAdmin();
    const { data, error } = await db.rpc('wallet_credit_deposit', {
      p_user_id: meta.user_id, p_amount: amount, p_provider_reference: reference,
      p_metadata: { channel: verify.data.channel, paid_at: verify.data.paid_at }
    });
    if (error) throw error;

    return res.status(200).json({ ok: true, transaction: data });
  } catch (e) {
    console.error(e);
    // Non-2xx makes Paystack retry the webhook, which is safe since crediting is idempotent.
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
