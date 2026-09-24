// /api/mock-pay: the fake payment page for the MOCK provider. Development and tests only; it does nothing unless
// PAYMENT_PROVIDER=mock and ALLOW_MOCK_PAYMENTS=true, and never on a production deployment. No money moves.
const { HttpError, send, readJson, handler } = require('../http');
const { db } = require('../db');
const mock = require('../payments/mock');
const { processWebhook } = require('../payments/core');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = handler(['GET', 'POST'], async (req, res) => {
  if (process.env.PAYMENT_PROVIDER !== 'mock' || !mock.configured()) throw new HttpError(404, 'Not found', 'not_found');

  if (req.method === 'POST') {
    const { reference, outcome } = await readJson(req);
    if (!['success', 'fail'].includes(outcome)) throw new HttpError(400, 'outcome must be success or fail', 'bad_request');
    const { data: pay } = await db().from('payments').select('id, raw, status').eq('reference', reference).maybeSingle();
    if (!pay || pay.status === 'successful') throw new HttpError(404, 'Payment not found or already paid', 'not_found');
    await db().from('payments').update({ raw: { ...(pay.raw || {}), mock: { outcome } } }).eq('id', pay.id);
    // same path as a real provider: a signed webhook, verified and de-duplicated by processWebhook
    const raw = JSON.stringify({ eventId: `mock:${reference}:${outcome}`, type: outcome === 'success' ? 'payment.success' : 'payment.failed', reference });
    await processWebhook('mock', raw, { 'x-mock-signature': mock.sign(raw) });
    return send(res, 200, { ok: true });
  }

  const reference = new URL(req.url, 'http://x').searchParams.get('reference') || '';
  const { data: pay } = await db().from('payments').select('amount, status').eq('reference', reference).maybeSingle();
  if (!pay) throw new HttpError(404, 'Payment not found', 'not_found');
  res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test payment</title>
<body style="font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 20px;text-align:center">
<div style="background:#fff3cd;border:2px solid #f0ad4e;border-radius:12px;padding:14px;font-weight:700">TEST MODE: this is not a real payment. No money moves.</div>
<h2>Pay ₦${Number(pay.amount).toLocaleString('en-NG')}</h2><p style="color:#666">Reference ${esc(reference)}</p>
<button id="ok" style="width:100%;padding:14px;font-size:16px;border-radius:10px;border:0;background:#1a7f37;color:#fff;margin:6px 0">Simulate successful payment</button>
<button id="no" style="width:100%;padding:14px;font-size:16px;border-radius:10px;border:0;background:#c0392b;color:#fff;margin:6px 0">Simulate failed payment</button>
<script>
async function go(o){const r=await fetch('/api/mock-pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:${JSON.stringify(reference)},outcome:o})});
if(r.ok)location.href='/?pay_return=1&reference='+encodeURIComponent(${JSON.stringify(reference)});else alert('Could not simulate: '+(await r.text()))}
document.getElementById('ok').onclick=()=>go('success');document.getElementById('no').onclick=()=>go('fail');</script></body>`);
});
