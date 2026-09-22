// Server-side tools the assistant may call. The model never touches the database directly:
// every argument is validated with zod, every query is built here, and IDs are re-checked against the database.
const crypto = require('crypto');
const { z } = require('zod');
const { ESCALATE_KEYS } = require('./language');

const COLS = 'id,name,price,original_price,category,category_id,brand,stock,description,image_url,images,attributes,vendor_id,created_at';
const HIDDEN_ATTR = new Set(['_type', 'tags', 'image_alt', 'ai_assisted', 'about']);

/* ------------------------------------------------------------------ helpers */
// vendor text is UNTRUSTED: strip control chars/markup fences and cap the length before the model sees it
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/```+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, n);
const token = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]/g, '');
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'under', 'below', 'over', 'above', 'less', 'than', 'me', 'my', 'some', 'any', 'to', 'of', 'in', 'on', 'good', 'best', 'cheap', 'nice']);

function stem(t) {
  if (t.length > 4 && t.endsWith('sses')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}
function queryTokens(q) {
  return [...new Set(String(q || '').split(/\s+/).map(token).filter(t => t.length >= 2 && !STOP.has(t)).map(stem))].slice(0, 5);
}

function attrSummary(attrs) {
  const out = {};
  if (!attrs || typeof attrs !== 'object') return out;
  Object.keys(attrs).forEach(k => {
    if (HIDDEN_ATTR.has(k) || Object.keys(out).length >= 14) return;
    const v = attrs[k];
    if (v == null || v === '') return;
    if (k === 'sizes' && v && typeof v === 'object') out.sizes = clean((v.system ? v.system + ': ' : '') + (v.values || []).join(', '), 120);
    else if ((k === 'specs' || k === 'extra') && Array.isArray(v)) v.slice(0, 10).forEach(p => { if (p && p.k && p.v && Object.keys(out).length < 14) out[clean(p.k, 40)] = clean(p.v, 80); });
    else if (Array.isArray(v)) out[clean(k, 40)] = clean(v.join(', '), 120);
    else if (typeof v !== 'object') out[clean(k, 40)] = clean(v, 120);
  });
  return out;
}

const availability = stock => (stock == null || Number(stock) <= 0 ? 'out_of_stock' : Number(stock) <= 5 ? 'low_stock' : 'in_stock');

function publicProduct(p, vendors, siteUrl, full) {
  const imgs = Array.isArray(p.images) && p.images.length ? p.images : (p.image_url ? [p.image_url] : []);
  const v = p.vendor_id && vendors ? vendors[p.vendor_id] : null;
  const o = {
    id: p.id, name: clean(p.name, 140), price: Number(p.price), originalPrice: p.original_price ? Number(p.original_price) : null,
    brand: clean(p.brand, 60) || null, category: clean(p.category, 60) || null,
    availability: availability(p.stock), stock: Math.max(0, Number(p.stock) || 0),
    image: imgs[0] || null, url: (siteUrl || '') + '/?p=' + p.id,
    seller: v ? clean(v.business_name, 60) : null,
    summary: clean(p.description, full ? 1200 : 220),
    details: attrSummary(p.attributes)
  };
  return o;
}

async function loadVendors(db, rows) {
  const ids = [...new Set(rows.map(r => r.vendor_id).filter(Boolean))];
  if (!ids.length) return {};
  try {
    const { data } = await db.from('vendors').select('id,business_name').in('id', ids).eq('status', 'approved');
    const m = {}; (data || []).forEach(v => { m[v.id] = v; }); return m;
  } catch { return {}; }
}

async function selectProducts(db, build) {
  let r = await build(COLS);
  if (r.error) r = await build('*');           // older databases without every column
  return r.error ? [] : (r.data || []);
}

let catCache = null;
async function loadCategoryRows(db) {
  if (catCache && Date.now() - catCache.t < 60000) return catCache.rows;
  try {
    const { data } = await db.from('categories').select('id,name,slug,parent_id,is_active').eq('is_active', true).limit(500);
    catCache = { t: Date.now(), rows: data || [] };
  } catch { catCache = { t: Date.now(), rows: [] }; }
  return catCache.rows;
}
const _resetCaches = () => { catCache = null; };

function categoryIds(rows, wanted) {
  const w = String(wanted || '').trim().toLowerCase();
  if (!w) return [];
  const roots = rows.filter(c => String(c.name || '').toLowerCase() === w || String(c.slug || '').toLowerCase() === w || String(c.name || '').toLowerCase().includes(w));
  const out = new Set(roots.map(c => c.id));
  let grew = true;
  while (grew) { grew = false; rows.forEach(c => { if (c.parent_id != null && out.has(c.parent_id) && !out.has(c.id)) { out.add(c.id); grew = true; } }); }
  return [...out];
}

/* ------------------------------------------------------------------ argument schemas */
const id = z.coerce.number().int().positive().max(1e12);
const SCHEMAS = {
  searchProducts: z.object({
    query: z.string().trim().max(120).optional(), category: z.string().trim().max(80).optional(),
    minPrice: z.coerce.number().nonnegative().max(1e10).optional(), maxPrice: z.coerce.number().nonnegative().max(1e10).optional(),
    brand: z.string().trim().max(60).optional(), color: z.string().trim().max(40).optional(), size: z.string().trim().max(30).optional(),
    inStockOnly: z.coerce.boolean().optional(), sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest']).optional(),
    limit: z.coerce.number().int().min(1).max(10).optional()
  }).strict(),
  getProductDetails: z.object({ id }).strict(),
  compareProducts: z.object({ ids: z.array(id).min(2).max(4) }).strict(),
  getCategories: z.object({}).strict(),
  getStorePolicies: z.object({}).strict(),
  getOrderStatus: z.object({ orderNumber: z.string().trim().max(40).optional() }).strict(),
  showProducts: z.object({ items: z.array(z.object({ id, reason: z.string().trim().max(160).optional() })).min(1).max(6) }).strict(),
  navigateToProduct: z.object({ id }).strict(),
  addToCart: z.object({ id, quantity: z.coerce.number().int().min(1).max(10).optional() }).strict(),
  prepareSupportTicket: z.object({
    category: z.enum(['order_issue', 'delivery', 'payment', 'refund_dispute', 'fraud', 'account_security', 'product_issue', 'safety', 'legal', 'threat_harassment', 'medical', 'other']),
    summary: z.string().trim().min(10).max(800), orderNumber: z.string().trim().max(40).optional(), productId: id.optional(),
    contactName: z.string().trim().max(80).optional(), contactEmail: z.string().trim().email().max(120).optional(), contactPhone: z.string().trim().max(30).optional()
  }).strict()
};

const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: properties || {}, required: required || [], additionalProperties: false } } });
const TOOL_DEFS = [
  fn('searchProducts', 'Search the store catalogue. Use ENGLISH product keywords in "query" (translate from the customer\'s language). Prices are in the store currency.', {
    query: { type: 'string', description: 'English keywords, e.g. "running shoes"' }, category: { type: 'string' }, minPrice: { type: 'number' }, maxPrice: { type: 'number' },
    brand: { type: 'string' }, color: { type: 'string' }, size: { type: 'string' }, inStockOnly: { type: 'boolean' },
    sort: { type: 'string', enum: ['relevance', 'price_asc', 'price_desc', 'newest'] }, limit: { type: 'integer', minimum: 1, maximum: 10 } }),
  fn('getProductDetails', 'Get full real details (price, stock, description, attributes, seller) of one product by id.', { id: { type: 'integer' } }, ['id']),
  fn('compareProducts', 'Compare 2-4 products side by side using real data. Shows a comparison table to the customer.', { ids: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 4 } }, ['ids']),
  fn('getCategories', 'List the store categories.'),
  fn('getStorePolicies', 'Get the store delivery, returns and warranty text and contact details. Only these are real; never guess policies.'),
  fn('getOrderStatus', 'Look up the signed-in customer\'s own orders. Optionally pass an order number. Fails if the customer is not signed in.', { orderNumber: { type: 'string' } }),
  fn('showProducts', 'Display product cards to the customer (max 6) with a short reason each. Call after searching/recommending. Only use ids returned by other tools.', {
    items: { type: 'array', maxItems: 6, items: { type: 'object', properties: { id: { type: 'integer' }, reason: { type: 'string', description: 'Why it fits, max 15 words, in the customer\'s language' } }, required: ['id'] } } }, ['items']),
  fn('navigateToProduct', 'Give the customer a button to open one product page.', { id: { type: 'integer' } }, ['id']),
  fn('addToCart', 'Offer to add a product to the cart. Only when the customer clearly asked to add that exact product. The customer still has to tap a confirm button.', { id: { type: 'integer' }, quantity: { type: 'integer', minimum: 1, maximum: 10 } }, ['id']),
  fn('prepareSupportTicket', 'Prepare (NOT submit) a support ticket. The customer must confirm with a button. Collect the details first.', {
    category: { type: 'string', enum: ['order_issue', 'delivery', 'payment', 'refund_dispute', 'fraud', 'account_security', 'product_issue', 'safety', 'legal', 'threat_harassment', 'medical', 'other'] },
    summary: { type: 'string', description: 'Clear neutral summary of the problem' }, orderNumber: { type: 'string' }, productId: { type: 'integer' },
    contactName: { type: 'string' }, contactEmail: { type: 'string' }, contactPhone: { type: 'string' } }, ['category', 'summary'])
];

/* ------------------------------------------------------------------ ticket signing (confirm step is enforced by the server) */
function secret() {
  return process.env.AI_SIGNING_SECRET || crypto.createHash('sha256').update('ai-ticket:' + (process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-only')).digest('hex');
}
const b64 = b => Buffer.from(b).toString('base64url');
function signTicket(payload) {
  const body = b64(JSON.stringify(payload));
  return body + '.' + crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}
function verifyTicket(tok, now) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p && p.exp > (now || Date.now()) ? p : null; } catch { return null; }
}

/* ------------------------------------------------------------------ tool implementations */
async function searchProducts(a, ctx) {
  const db = ctx.db;
  const cats = a.category ? await loadCategoryRows(db) : [];
  const catIds = a.category ? categoryIds(cats, a.category) : [];
  const toks = queryTokens(a.query);
  const run = async (o) => {
    const rows = await selectProducts(db, cols => {
      let q = db.from('products').select(cols).order('created_at', { ascending: false }).limit(250);
      if (o.minPrice != null) q = q.gte('price', o.minPrice);
      if (o.maxPrice != null) q = q.lte('price', o.maxPrice);
      if (o.inStockOnly) q = q.gt('stock', 0);
      const brand = token(o.brand);
      if (brand) q = q.ilike('brand', `%${brand}%`);
      if (o.category) {
        const cn = token(o.category);
        const parts = [];
        if (catIds.length) parts.push(`category_id.in.(${catIds.join(',')})`);
        if (cn) parts.push(`category.ilike.%${cn}%`);
        if (parts.length) q = q.or(parts.join(','));
      }
      toks.forEach(t => { q = q.or(`name.ilike.%${t}%,brand.ilike.%${t}%,category.ilike.%${t}%,description.ilike.%${t}%`); });
      return q;
    });
    const col = token(o.color), size = String(o.size || '').trim().toLowerCase();
    let out = rows.filter(p => {
      const hay = (p.name + ' ' + (p.description || '') + ' ' + JSON.stringify(p.attributes || {})).toLowerCase();
      if (col && !hay.includes(col)) return false;
      if (size && !hay.includes(size)) return false;
      return true;
    });
    const score = p => toks.reduce((n, t) => n + (String(p.name).toLowerCase().includes(t) ? 3 : 0) + (String(p.brand || '').toLowerCase().includes(t) ? 2 : 0) +
      (String(p.category || '').toLowerCase().includes(t) ? 2 : 0) + (String(p.description || '').toLowerCase().includes(t) ? 1 : 0), 0);
    const sort = o.sort || 'relevance';
    out = out.map(p => ({ p, s: score(p) }));
    if (sort === 'price_asc') out.sort((x, y) => x.p.price - y.p.price);
    else if (sort === 'price_desc') out.sort((x, y) => y.p.price - x.p.price);
    else if (sort === 'newest') out.sort((x, y) => String(y.p.created_at).localeCompare(String(x.p.created_at)));
    else out.sort((x, y) => y.s - x.s || (Number(y.p.stock > 0) - Number(x.p.stock > 0)));
    return out.map(x => x.p);
  };

  const found = await run(a);
  const limit = a.limit || 6;
  const shown = found.slice(0, limit);
  const vendors = await loadVendors(db, shown);
  shown.forEach(p => ctx.seen.set(p.id, p));
  const result = { total: found.length, products: shown.map(p => publicProduct(p, vendors, ctx.siteUrl)) };

  if (!found.length) {
    // tell the model which single filter, if relaxed, would produce results (so it can suggest that one change)
    const relax = [];
    for (const k of ['maxPrice', 'minPrice', 'brand', 'color', 'size', 'category', 'inStockOnly']) {
      if (a[k] == null || a[k] === false || a[k] === '') continue;
      const n = (await run(Object.assign({}, a, { [k]: undefined }))).length;
      if (n) relax.push({ dropFilter: k, wouldFind: Math.min(n, 250) });
      if (relax.length >= 3) break;
    }
    result.hint = relax.length ? { relaxOneFilter: relax } : 'Nothing close in the catalogue. Suggest broader keywords or browsing categories.';
  }
  ctx.state.lastSearch = { category: a.category || null, minPrice: a.minPrice == null ? null : a.minPrice, maxPrice: a.maxPrice == null ? null : a.maxPrice };
  return result;
}

async function fetchByIds(ids, ctx) {
  const unique = [...new Set(ids)].slice(0, 6);
  const rows = await selectProducts(ctx.db, cols => ctx.db.from('products').select(cols).in('id', unique));
  const vendors = await loadVendors(ctx.db, rows);
  rows.forEach(p => ctx.seen.set(p.id, p));
  return { rows, vendors };
}

async function getProductDetails(a, ctx) {
  const { rows, vendors } = await fetchByIds([a.id], ctx);
  if (!rows.length) return { error: 'not_found', message: 'No product with that id exists.' };
  const out = publicProduct(rows[0], vendors, ctx.siteUrl, true);
  try {
    const r = await ctx.db.from('product_ratings').select('avg_rating,review_count').eq('product_id', a.id).maybeSingle();
    if (r && r.data) out.rating = { average: Number(r.data.avg_rating), reviews: Number(r.data.review_count) };
  } catch { /* view not created yet */ }
  ctx.state.discussed(out.id, out.name);
  return out;
}

async function compareProducts(a, ctx) {
  const { rows, vendors } = await fetchByIds(a.ids, ctx);
  if (rows.length < 2) return { error: 'not_found', message: 'Fewer than two of those products exist.' };
  const items = rows.map(p => publicProduct(p, vendors, ctx.siteUrl, true));
  const keys = [...new Set(items.flatMap(i => Object.keys(i.details)))].slice(0, 12);
  ctx.cards.push({ kind: 'compare', products: items.map(i => ({ id: i.id, name: i.name, price: i.price, image: i.image, availability: i.availability, brand: i.brand, seller: i.seller })), keys,
    rows: keys.map(k => ({ label: k, values: items.map(i => i.details[k] || null) })) });
  ctx.state.compareIds = items.map(i => i.id);
  items.forEach(i => ctx.state.discussed(i.id, i.name));
  return { products: items, note: 'A comparison table is already shown to the customer. Summarise the key differences briefly using only this data.' };
}

async function getCategories(a, ctx) {
  const rows = await loadCategoryRows(ctx.db);
  const kids = {};
  rows.forEach(c => { if (c.parent_id != null) (kids[c.parent_id] = kids[c.parent_id] || []).push(clean(c.name, 40)); });
  return { categories: rows.filter(c => c.parent_id == null).slice(0, 40).map(c => ({ name: clean(c.name, 40), subcategories: (kids[c.id] || []).slice(0, 15) })) };
}

async function getStorePolicies(a, ctx) {
  const { data } = await ctx.db.from('store_settings').select('key,value');
  const get = k => { const r = (data || []).find(x => x.key === k); return r && r.value ? clean(r.value, 1200) : null; };
  return { store: get('storeName'), delivery: get('deliveryInfo'), returns: get('returnPolicy'), warranty: get('warrantyInfo'), phone: get('phone'), email: get('contactEmail'),
    note: 'Any null field is NOT provided by the store: say so and offer support. Never invent policy details, delivery dates or fees.' };
}

async function getOrderStatus(a, ctx) {
  if (!ctx.user) { ctx.actions.push({ type: 'sign_in' }); return { error: 'not_signed_in', message: 'The customer is not signed in. Ask them to sign in to see their orders.' }; }
  const cols = 'id,order_number,created_at,total,status,payment_status,fulfillment_status,items';
  const base = () => ctx.db.from('orders').select(cols).eq('user_id', ctx.user.id);   // ALWAYS scoped to the verified user
  let rows = [];
  if (a.orderNumber) {
    const num = a.orderNumber.replace(/^#/, '');
    let r = await base().eq('order_number', num).limit(1);
    if (r.error) r = await ctx.db.from('orders').select('*').eq('user_id', ctx.user.id).eq('id', Number(num) || -1).limit(1);
    rows = r.data || [];
    if (!rows.length && /^\d+$/.test(num)) { const r2 = await base().eq('id', Number(num)).limit(1); rows = r2.data || []; }
    if (!rows.length) return { error: 'not_found', message: 'No order with that number was found on this account.' };
  } else {
    let r = await base().order('created_at', { ascending: false }).limit(3);
    if (r.error) r = await ctx.db.from('orders').select('*').eq('user_id', ctx.user.id).order('created_at', { ascending: false }).limit(3);
    rows = r.data || [];
    if (!rows.length) return { orders: [], message: 'This account has no orders yet.' };
  }
  const out = [];
  for (const o of rows) {
    let ships = [];
    try { const s = await ctx.db.from('shipments').select('*').eq('order_id', o.id); ships = s.data || []; } catch { /* tracking tables not installed */ }
    out.push({
      orderNumber: o.order_number || String(o.id), placedAt: o.created_at, total: Number(o.total), items: Array.isArray(o.items) ? o.items.length : null,
      payment: o.payment_status || null, delivery: o.fulfillment_status || o.status || null,
      shipments: ships.slice(0, 5).map(s => ({ status: clean(s.status, 40), carrier: clean(s.carrier_name || s.carrier, 40) || null, trackingNumber: clean(s.tracking_number, 60) || null, estimatedDelivery: s.estimated_delivery || s.eta_at || null }))
    });
  }
  ctx.cards.push({ kind: 'orders', orders: out.map(o => ({ orderNumber: o.orderNumber, placedAt: o.placedAt, total: o.total, delivery: o.delivery, payment: o.payment, id: (rows.find(r => String(r.order_number || r.id) === o.orderNumber) || {}).id })) });
  return { orders: out, note: 'Only share these details with this customer. Do not invent delivery dates.' };
}

async function showProducts(a, ctx) {
  const ids = a.items.map(i => i.id);
  const missing = ids.filter(i => !ctx.seen.has(i));
  if (missing.length) await fetchByIds(missing, ctx);          // never trust model ids: re-read from the database
  const vendors = await loadVendors(ctx.db, ids.map(i => ctx.seen.get(i)).filter(Boolean));
  const shown = [];
  a.items.forEach(i => {
    const row = ctx.seen.get(i.id);
    if (!row) return;
    const p = publicProduct(row, vendors, ctx.siteUrl);
    ctx.cards.push({ kind: 'product', id: p.id, name: p.name, price: p.price, originalPrice: p.originalPrice, image: p.image, availability: p.availability, brand: p.brand, seller: p.seller, reason: clean(i.reason, 160) || null });
    ctx.state.discussed(p.id, p.name);
    shown.push(p.id);
  });
  if (!shown.length) return { error: 'not_found', message: 'None of those product ids exist. Search first and use the returned ids.' };
  return { shown, note: 'Cards are displayed to the customer with the real price and stock. Do not repeat the full list in text.' };
}

async function navigateToProduct(a, ctx) {
  const { rows } = await fetchByIds([a.id], ctx);
  if (!rows.length) return { error: 'not_found' };
  ctx.actions.push({ type: 'open_product', id: rows[0].id, name: clean(rows[0].name, 140) });
  return { ok: true, note: 'A button to open the product is shown to the customer.' };
}

async function addToCart(a, ctx) {
  const { rows } = await fetchByIds([a.id], ctx);
  if (!rows.length) return { error: 'not_found' };
  const p = rows[0];
  if (availability(p.stock) === 'out_of_stock') return { error: 'out_of_stock', message: 'This product is out of stock, so it cannot be added.' };
  const qty = Math.min(a.quantity || 1, Math.max(1, Number(p.stock) || 1), 10);
  const pub = publicProduct(p, null, ctx.siteUrl);
  ctx.actions.push({ type: 'add_to_cart', id: p.id, name: pub.name, price: pub.price, image: pub.image, quantity: qty });
  ctx.state.discussed(p.id, pub.name);
  return { status: 'awaiting_user_confirmation', message: 'A confirm button was shown. The item is NOT in the cart until the customer taps it.' };
}

async function prepareSupportTicket(a, ctx) {
  const email = a.contactEmail || (ctx.user && ctx.user.email) || null;
  const name = a.contactName || (ctx.user && ctx.user.user_metadata && (ctx.user.user_metadata.full_name || ctx.user.user_metadata.name)) || null;
  if (!email && !a.contactPhone) return { error: 'need_contact', message: 'Ask the customer for an email address or phone number so support can reach them.' };
  let orderVerified = false, productName = null;
  if (a.orderNumber && ctx.user) {
    const num = a.orderNumber.replace(/^#/, '');
    const r = await ctx.db.from('orders').select('id,order_number').eq('user_id', ctx.user.id).eq('order_number', num).limit(1);
    orderVerified = !!(r.data && r.data.length);
  }
  if (a.productId) { const { rows } = await fetchByIds([a.productId], ctx); productName = rows[0] ? clean(rows[0].name, 140) : null; }
  const needsHuman = ESCALATE_KEYS.includes(a.category) || !!ctx.escalate;
  const ticket = {
    category: a.category, priority: needsHuman ? 'high' : 'normal', needsHuman, summary: clean(a.summary, 800),
    orderNumber: a.orderNumber ? clean(a.orderNumber, 40) : null, orderVerified, productId: a.productId || null, productName,
    name: name ? clean(name, 80) : null, email: email ? clean(email, 120) : null, phone: a.contactPhone ? clean(a.contactPhone, 30) : null, language: ctx.lang
  };
  const nonce = crypto.randomBytes(9).toString('base64url');
  ctx.ticket = { token: signTicket({ t: ticket, uid: ctx.user ? ctx.user.id : 'anon', exp: Date.now() + 20 * 60 * 1000, n: nonce }), preview: ticket };
  return { status: 'awaiting_user_confirmation', message: 'A summary with Submit / Cancel buttons is shown. Tell the customer what will be sent and ask them to confirm with the button. You cannot submit it. Do NOT say it was sent.' };
}

const IMPL = { searchProducts, getProductDetails, compareProducts, getCategories, getStorePolicies, getOrderStatus, showProducts, navigateToProduct, addToCart, prepareSupportTicket };

/** Runs one tool call. Always returns a JSON-able object; never throws to the model loop. */
async function runTool(name, rawArgs, ctx) {
  const schema = SCHEMAS[name];
  if (!schema || !IMPL[name]) return { error: 'unknown_tool' };
  let args;
  try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {}); } catch { return { error: 'invalid_arguments', message: 'Arguments were not valid JSON.' }; }
  const parsed = schema.safeParse(args);
  if (!parsed.success) return { error: 'invalid_arguments', message: parsed.error.issues.slice(0, 3).map(i => i.path.join('.') + ': ' + i.message).join('; ') };
  if (name === 'searchProducts' && parsed.data.minPrice != null && parsed.data.maxPrice != null && parsed.data.minPrice > parsed.data.maxPrice) return { error: 'invalid_arguments', message: 'minPrice is greater than maxPrice.' };
  try { return await IMPL[name](parsed.data, ctx); }
  catch (e) { console.error('[ai-tool]', name, e && e.message); return { error: 'tool_failed', message: 'That lookup failed. Tell the customer you could not check right now.' }; }
}

module.exports = { TOOL_DEFS, SCHEMAS, runTool, signTicket, verifyTicket, publicProduct, queryTokens, clean, availability, _resetCaches };
