// /api/verify-bank.js
//
// Real bank account verification using Paystack's "Resolve Account Number"
// endpoint (https://paystack.com/docs/api/verification/#resolve-account) —
// this is a genuine, publicly documented API, not a placeholder. It returns
// the account holder's name for a given bank + account number so we can
// confirm the seller entered their own payout account correctly, without
// ever asking them to upload a bank statement or similar sensitive document.
//
// Required environment variable:
//   PAYSTACK_SECRET_KEY   (Paystack Dashboard -> Settings -> API Keys & Webhooks)
//
// Also required (same as elsewhere): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { accountNumber, bankCode, bankName } = body || {};
    if (!accountNumber || !bankCode) return res.status(400).json({ error: 'accountNumber and bankCode are required' });

    if (!process.env.PAYSTACK_SECRET_KEY) {
      // Save what we have and mark it for manual review rather than pretending it's verified.
      await supabaseAdmin.from('vendors').update({
        bank_name: bankName || null, bank_code: bankCode, bank_account_number: accountNumber,
        bank_verification_status: 'pending'
      }).eq('id', user.id);
      return res.status(200).json({ status: 'pending', message: 'Bank verification isn\'t configured yet — saved for manual review.' });
    }

    const psRes = await fetch(`https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const psJson = await psRes.json();

    if (!psRes.ok || !psJson.status) {
      await supabaseAdmin.from('vendors').update({
        bank_name: bankName || null, bank_code: bankCode, bank_account_number: accountNumber,
        bank_verification_status: 'failed'
      }).eq('id', user.id);
      return res.status(200).json({ status: 'failed', message: psJson.message || 'Could not verify this account.' });
    }

    const accountName = psJson.data.account_name;
    await supabaseAdmin.from('vendors').update({
      bank_name: bankName || null, bank_code: bankCode, bank_account_number: accountNumber,
      bank_account_name: accountName, bank_verification_status: 'verified',
      bank_verification_ref: String(psJson.data.account_number || accountNumber)
    }).eq('id', user.id);

    return res.status(200).json({ status: 'verified', accountName });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
