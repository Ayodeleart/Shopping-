// POST /api/ai-product  — AI-assisted product draft for approved vendors and admins.
// Auth: Authorization: Bearer <supabase access token>. The Groq key stays on the server.
// Returns a DRAFT only; the vendor reviews, edits and saves through the normal product form.
const { getAdmin } = require('./_lib/db');
const { getUser, isVendorOrAdmin, clientIp, rateLimit, logUsage } = require('./_lib/ai/guard');
const { AIError } = require('./_lib/ai/groq');
const { generateDraft } = require('./_lib/ai/product-draft');

async function loadCategories(db) {
  try {
    const { data } = await db.from('categories').select('id,name,parent_id,is_active').eq('is_active', true).limit(400);
    return data || [];
  } catch { return []; }
}

// map the suggested category text onto a real category id, only when it is unambiguous
function matchCategory(name, rows) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const hits = rows.filter(r => String(r.name || '').trim().toLowerCase() === n);
  return hits.length === 1 ? hits[0].id : null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const started = Date.now();
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const db = getAdmin();
    const user = await getUser(req, db);
    if (!user) return res.status(401).json({ error: 'Please sign in again.' });
    if (!(await isVendorOrAdmin(user, db))) return res.status(403).json({ error: 'Only approved sellers and admins can use this.' });

    const rl = rateLimit('prod:' + user.id, 12, 10 * 60 * 1000);
    if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); return res.status(429).json({ error: 'You are generating too fast. Please wait a moment.', retryAfter: rl.retryAfter }); }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const catRows = await loadCategories(db);
    const names = [...new Set(catRows.map(c => c.name).filter(Boolean))];
    const result = await generateDraft(body, { categories: names });
    const draft = result.draft;
    const categoryId = matchCategory(draft.category, catRows);
    if (draft.category && categoryId == null && names.length) draft.warnings.push(`Suggested category "${draft.category}" is not one of the store categories. Choose one yourself.`);

    logUsage('ai_product', { ok: true, ms: Date.now() - started, vision: result.usedVision, regen: !!(body.fields && body.fields.length), flagged: result.flagged.length, uid: user.id.slice(0, 8) });
    return res.status(200).json({ draft, categoryId, notice: 'AI-generated draft — please review before publishing.' });
  } catch (e) {
    if (e instanceof AIError) {
      logUsage('ai_product', { ok: false, code: e.code, ms: Date.now() - started });
      return res.status(e.status).json({ error: e.publicMessage });
    }
    if (e instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request.' });
    console.error('[ai-product]', e && e.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
