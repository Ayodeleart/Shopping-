// /api/payment-methods.js
// Saved payment methods, backed by Paystack's reusable "authorization" tokens.
// Never stores raw card numbers/CVV/PIN — only what Paystack returns after a real charge:
// authorization_code, card brand, last4, bank, expiry.
//
// Flow to ADD a card: the client runs a small (e.g. ₦50) verification charge with Paystack Inline
// (channels: ['card']) so the customer authenticates the card themselves; once that transaction's
// reference comes back, POST it here — this endpoint re-verifies it server-side with Paystack
// before saving anything, exactly like the deposit webhook does.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY

const { getAdmin } = require('./_lib/db');

async function authedUser(req, db) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data: { user }, error } = await db.auth.getUser(token);
  return error ? null : user;
}

module.exports = async (req, res) => {
  try {
    const db = getAdmin();
    const user = await authedUser(req, db);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    if (req.method === 'GET') {
      const { data, error } = await db.from('customer_payment_methods')
        .select('id,provider,card_type,last4,bank,exp_month,exp_year,is_default,created_at')
        .eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ payment_methods: data });
    }

    if (req.method === 'POST') {
      if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: 'Payments are not configured yet' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

      if (body.action === 'set_default') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'id required' });
        await db.from('customer_payment_methods').update({ is_default: false }).eq('user_id', user.id);
        const { error } = await db.from('customer_payment_methods').update({ is_default: true }).eq('id', id).eq('user_id', user.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      // default action: add a new card from a verified Paystack reference
      const reference = body.reference;
      if (!reference) return res.status(400).json({ error: 'reference required' });

      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
      const verify = await verifyRes.json();
      if (!verifyRes.ok || !verify.status || !verify.data || verify.data.status !== 'success') {
        return res.status(400).json({ error: 'Card verification was not successful' });
      }
      const auth = verify.data.authorization;
      if (!auth || !auth.reusable || !auth.authorization_code) {
        return res.status(400).json({ error: 'This card cannot be saved for future payments' });
      }
      if (verify.data.customer && verify.data.customer.email && verify.data.customer.email.toLowerCase() !== (user.email || '').toLowerCase()) {
        return res.status(400).json({ error: 'Card does not belong to this account' });
      }

      const { count } = await db.from('customer_payment_methods').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
      const { data, error } = await db.from('customer_payment_methods').insert({
        user_id: user.id, provider: 'paystack', provider_customer_code: verify.data.customer && verify.data.customer.customer_code,
        authorization_code: auth.authorization_code, card_type: auth.card_type, last4: auth.last4,
        bank: auth.bank, exp_month: auth.exp_month, exp_year: auth.exp_year, is_default: !count
      }).select().single();
      if (error) {
        if (error.code === '23505') return res.status(200).json({ ok: true, already_saved: true });
        throw error;
      }
      return res.status(200).json({ ok: true, payment_method: data });
    }

    if (req.method === 'DELETE') {
      const id = (req.query && req.query.id) || (req.body && req.body.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const { error } = await db.from('customer_payment_methods').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
