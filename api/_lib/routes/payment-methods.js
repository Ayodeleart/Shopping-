// GET /api/payment-methods -> the payment methods the configured provider offers (the checkout page shows exactly these)
// plus the fees the customer will be charged, so the total on screen matches what checkout creates.
const { handler, send } = require('../http');
const { db } = require('../db');
const providers = require('../payments');

async function pricing() {
  const { data } = await db().from('platform_config').select('key, value').in('key', ['delivery_fee', 'service_fee', 'tax_rate']);
  const m = {}; (data || []).forEach(r => { m[r.key] = Number(r.value) || 0; });
  return { delivery_fee: m.delivery_fee || 0, service_fee: m.service_fee || 0, tax_rate: m.tax_rate || 0 };
}

module.exports = handler(['GET'], async (req, res) => {
  const p = providers.active();
  const pr = await pricing().catch(() => ({ delivery_fee: 0, service_fee: 0, tax_rate: 0 }));
  if (!p) return send(res, 200, { configured: false, methods: [], pricing: pr });
  send(res, 200, { configured: true, provider: p.id, is_test: !!p.isTest, methods: p.methods(), pricing: pr });
});
