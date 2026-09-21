// /api/paystack-banks.js
// Returns the list of Nigerian banks with their Paystack bank codes, for the
// payout step's bank dropdown. Needs PAYSTACK_SECRET_KEY (see verify-bank.js).
// No auth required — this is public reference data, not seller-specific.

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(200).json({ configured: false, banks: [] });
  }
  try {
    const psRes = await fetch('https://api.paystack.co/bank?country=nigeria&currency=NGN', {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const psJson = await psRes.json();
    if (!psRes.ok) throw new Error(psJson.message || 'Failed to load bank list');
    const banks = (psJson.data || []).map(b => ({ name: b.name, code: b.code })).sort((a, b) => a.name.localeCompare(b.name));
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    return res.status(200).json({ configured: true, banks });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
