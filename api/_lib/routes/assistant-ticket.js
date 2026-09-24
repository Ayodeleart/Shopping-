// POST /api/assistant-ticket — creates the support ticket ONLY after the customer pressed "Submit" in the chat.
// The ticket contents come from a server-signed token created by the assistant, so the browser cannot forge or alter them,
// and the model cannot submit anything by itself.
const { getAdmin } = require('../db');
const { getUser, clientIp, rateLimit, logUsage } = require('../ai/guard');
const { verifyTicket } = require('../ai/tools');

const used = new Set();   // per warm instance; the unique client_ref column is the real guard against replays

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const db = getAdmin();
    const user = await getUser(req, db);
    const who = user ? 'u:' + user.id : 'ip:' + clientIp(req);
    const rl = rateLimit('ticket:' + who, 4, 60 * 60 * 1000);
    if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); return res.status(429).json({ error: 'Too many support requests. Please wait before sending another.' }); }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const p = verifyTicket(body.token);
    if (!p) return res.status(400).json({ error: 'This request expired. Please ask the assistant to prepare it again.' });
    if (p.uid !== (user ? user.id : 'anon')) return res.status(403).json({ error: 'Please sign in with the same account and try again.' });
    if (used.has(p.n)) return res.status(409).json({ error: 'This request was already sent.' });

    const t = p.t;
    const row = {
      client_ref: p.n, user_id: user ? user.id : null, customer_name: t.name, email: t.email, phone: t.phone,
      order_number: t.orderNumber, order_verified: !!t.orderVerified, product_id: t.productId, product_name: t.productName,
      category: t.category, priority: t.priority, needs_human: !!t.needsHuman, summary: t.summary, language: t.language, source: 'ai_assistant'
    };
    const { data, error } = await db.from('support_tickets').insert([row]).select('id').single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'This request was already sent.' });
      console.error('[assistant-ticket]', error.code || '', error.message);
      const missing = error.code === '42P01' || error.code === 'PGRST205' || /support_tickets/.test(error.message || '');
      return res.status(missing ? 503 : 500).json({ error: missing ? 'Support requests are not available online yet. Please contact the store directly.' : 'We could not send your request. Please try again.' });
    }
    used.add(p.n);
    logUsage('assistant_ticket', { ok: true, cat: t.category, high: t.priority === 'high' });
    return res.status(200).json({ ok: true, ticketId: data.id });
  } catch (e) {
    if (e instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request.' });
    console.error('[assistant-ticket]', e && e.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
