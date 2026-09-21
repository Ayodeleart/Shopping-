// POST /api/assistant — the customer shopping assistant (chat + product tools).
// Optional auth (Authorization: Bearer <supabase token>) unlocks order lookups for that customer only.
const { getAdmin, siteUrlFrom } = require('./_lib/db');
const { getUser, clientIp, rateLimit, logUsage } = require('./_lib/ai/guard');
const { AIError } = require('./_lib/ai/groq');
const { runAssistant } = require('./_lib/ai/assistant-core');

async function storeInfo(db) {
  try {
    const { data } = await db.from('store_settings').select('key,value').in('key', ['storeName', 'currency']);
    const get = k => ((data || []).find(x => x.key === k) || {}).value;
    return { storeName: String(get('storeName') || 'Maccato').slice(0, 60), currency: String(get('currency') || '₦').slice(0, 5) };
  } catch { return { storeName: 'Maccato', currency: '₦' }; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const started = Date.now();
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const db = getAdmin();
    const user = await getUser(req, db);
    const who = user ? 'u:' + user.id : 'ip:' + clientIp(req);

    // burst limit and a slower hourly cap; signed-in customers get more room
    const a = rateLimit('chat:m:' + who, user ? 12 : 8, 60 * 1000);
    const b = rateLimit('chat:h:' + who, user ? 150 : 60, 60 * 60 * 1000);
    if (!a.ok || !b.ok) {
      const ra = (a.ok ? b : a).retryAfter;
      res.setHeader('Retry-After', String(ra));
      return res.status(429).json({ error: 'You are sending messages very fast. Please wait a few seconds and try again.', retryAfter: ra });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const out = await runAssistant(body, { db, user, siteUrl: siteUrlFrom(req), storeInfo: await storeInfo(db) });
    logUsage('assistant', { ok: true, ms: Date.now() - started, tools: out.toolCalls, lang: out.language, topic: out.topic, cards: out.cards.length, signedIn: !!user });
    return res.status(200).json({ reply: out.reply, cards: out.cards, actions: out.actions, ticket: out.ticket, state: out.state, language: out.language });
  } catch (e) {
    if (e instanceof AIError) {
      logUsage('assistant', { ok: false, code: e.code, ms: Date.now() - started });
      if (e.status === 429 && e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
      return res.status(e.status).json({ error: e.publicMessage });
    }
    if (e instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request.' });
    console.error('[assistant]', e && e.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
