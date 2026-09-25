const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

/* ── shared fixtures ─────────────────────────────────────────────── */

const catRows = [
  { id: 1, parent_id: null, slug: 'beauty', name: 'Beauty', is_active: true, sort_order: 1 },
  { id: 2, parent_id: 1, slug: 'makeup', name: 'Makeup', is_active: true, sort_order: 1 },
  { id: 3, parent_id: 2, slug: 'lipstick', name: 'Lipstick', is_active: true, sort_order: 1 },
  { id: 4, parent_id: 1, slug: 'mens-beauty', name: "Men's Beauty", is_active: true, sort_order: 2 },
  { id: 5, parent_id: 1, slug: 'kids-beauty', name: 'Kids Beauty', is_active: true, sort_order: 3 },
  { id: 6, parent_id: null, slug: 'phones', name: 'Phones', is_active: true, sort_order: 2 }
];

const prods = [
  { id: 11, name: 'Viva Glam Lipstick', price: 5000, category: 'Lipstick', category_id: 3, brand: 'MAC', created_at: '2026-09-01', image_url: 'https://x/a.jpg' },
  { id: 12, name: 'Face Cleanser', price: 3000, category: 'Skincare', category_id: null, brand: null, created_at: '2026-09-10', image_url: null },
  { id: 13, name: 'Men Beard Oil', price: 4000, category: 'Grooming', category_id: 4, brand: null, created_at: '2026-08-01', image_url: 'https://x/c.jpg' },
  { id: 14, name: 'Kids Shampoo', price: 2000, category: 'Kids Wash', category_id: 5, brand: null, created_at: '2026-07-01', image_url: 'https://x/d.jpg' },
  { id: 15, name: 'iPhone 15', price: 100000, category: 'Phones', category_id: 6, brand: 'Apple', created_at: '2026-09-15', image_url: 'https://x/e.jpg' }
];

const beautyCats = [
  { id: 1, name: 'All', slug: 'all', kind: 'all', sort_order: 1, active: true },
  { id: 2, name: 'New', slug: 'new', kind: 'new', sort_order: 2, active: true },
  { id: 3, name: 'Makeup', slug: 'makeup', kind: 'category', category_id: 2, sort_order: 3, active: true },
  { id: 4, name: 'Lips', slug: 'lips', kind: 'category', keywords: 'lips, lip', sort_order: 4, active: true },
  { id: 5, name: 'Hidden', slug: 'hidden', kind: 'category', sort_order: 5, active: false }
];

function bootWindow() {
  const dom = new JSDOM('<!doctype html><body><div id="wp"></div></body>', {
    url: 'https://shop.test/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = q => ({ matches: false, addListener() {}, addEventListener() {}, removeEventListener() {} });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLElement.prototype.scrollTo = function () {};
  w.eval(R('data/safe.js'));
  w.eval(R('data/categories.js'));
  w.eval(R('data/search.js'));
  w.eval(R('data/beauty.js'));
  w.eval(R('components/beauty-world.js'));
  return w;
}

function mountWorld(w, opts) {
  const o = Object.assign({
    heroes: [], cats: beautyCats, settings: { background_url: 'https://x/bg.jpg', background_enabled: '1' }, stats: {}
  }, opts || {});
  w.allProds = prods;
  w.catTree = new w.Pcx.Categories.Tree(catRows);
  w.vendorsMap = {};
  w.brandsList = [];
  w.brandById = {};
  w.ratingMap = {};
  w.favs = new Set();
  w.cart = [];
  w.currency = 'N';
  w.fmt = n => 'N' + Number(n);
  w.toggleFav = id => { w.favs.has(id) ? w.favs.delete(id) : w.favs.add(id); };
  w.ctlHTML = id => '<button type="button" class="pcAdd" data-add="' + id + '">Add to Cart</button>';
  w.openProduct = id => { w.__opened = id; };
  w.openStore = () => {};
  w.openCart = () => { w.__cart = true; };
  w.openAccount = () => { w.__acct = true; };
  w.showFavorites = () => { w.__favs = true; };
  const world = { slug: 'beauty', name: 'Beauty', gradient: 'linear-gradient(#333,#111)' };
  const inst = w.Pcx.BeautyWorld.mount(w.document.getElementById('wp'), world, {
    onBack: () => { w.__back = true; },
    beauty: {
      heroes: o.heroes, cats: o.cats, settings: Object.entries(o.settings).map(([key, value]) => ({ key, value })), stats: o.stats,
      catTree: w.catTree, products: w.allProds, vendors: w.vendorsMap, brands: w.brandsList, brandById: w.brandById, ratings: w.ratingMap, fmt: w.fmt
    }
  });
  return inst;
}

/* ── BeautyData (pure logic) ─────────────────────────────────────── */

test('beauty data: pool comes only from the real Beauty category subtree', () => {
  const w = bootWindow();
  const B = w.Pcx.BeautyData;
  const tree = new w.Pcx.Categories.Tree(catRows);
  assert.equal(B.root(tree).slug, 'beauty');
  assert.deepEqual(B.pool(tree, prods).map(p => p.id), [11, 13, 14]);
  assert.ok(B.isBeautyProduct(prods[0], tree));
  assert.ok(!B.isBeautyProduct(prods[4], tree));
  /* no Beauty anchor category -> empty world, never faked */
  const other = new w.Pcx.Categories.Tree(catRows.filter(c => c.slug !== 'beauty' && c.parent_id !== 1));
  assert.equal(B.root(other), null);
  assert.equal(B.pool(other, prods).length, 0);
});

test('beauty data: tile matchers use real category links and honest keywords', () => {
  const w = bootWindow();
  const B = w.Pcx.BeautyData;
  const tree = new w.Pcx.Categories.Tree(catRows);
  const pool = B.pool(tree, prods);
  const poolSet = new Set(pool.map(p => p.id));
  const names = p => (tree.path(p.category_id) || []).map(c => c.name).reverse();
  const ctx = { catTree: tree, poolSet, catNames: names };
  const byId = id => pool.find(p => p.id === id);

  assert.deepEqual(pool.filter(B.matchRow(beautyCats[0], ctx)).map(p => p.id), [11, 13, 14]);          // All
  assert.deepEqual(pool.filter(B.matchRow(beautyCats[2], ctx)).map(p => p.id), [11]);                  // Makeup (linked subtree)
  assert.deepEqual(pool.filter(B.matchRow(beautyCats[3], ctx)).map(p => p.id), [11]);                  // Lips ~ Lipstick keyword
  assert.ok(!B.matchRow(beautyCats[3], ctx)(byId(13)));
  assert.deepEqual(pool.filter(B.matchRow({ kind: 'category', keywords: 'fragrance' }, ctx)), []);     // no fakes
  /* active tiles only, sorted */
  assert.deepEqual(B.activeCats(beautyCats).map(c => c.slug), ['all', 'new', 'makeup', 'lips']);
});

test('beauty data: newest + popular sorts use real data only', () => {
  const w = bootWindow();
  const B = w.Pcx.BeautyData;
  const tree = new w.Pcx.Categories.Tree(catRows);
  const pool = B.pool(tree, prods);
  assert.deepEqual(B.sortNewest(pool).map(p => p.id), [11, 13, 14]);
  /* popularity = real sold qty + review counts; zero stays last, never invented */
  const stats = { 13: { sold: 2, reviews: 1 }, 14: { sold: 0, reviews: 4 } };
  const score = p => B.score(p, stats);
  assert.deepEqual(B.sortPopular(pool, score).map(p => p.id), [13, 14, 11]);
  assert.equal(score(prods[0]), 0);
  /* person filters exist only when a real category exists */
  const persons = B.personFilters(tree);
  assert.deepEqual(pool.filter(persons.man).map(p => p.id), [13]);
  assert.deepEqual(pool.filter(persons.kids).map(p => p.id), [14]);
  assert.equal(persons.woman, null, 'no Women category -> filter hidden, not faked');
});

test('beauty data: hero promos + settings mapping', () => {
  const w = bootWindow();
  const B = w.Pcx.BeautyData;
  const rows = [
    { id: 1, image_url: 'https://x/h1.gif', title: 'Glow', subtitle: 'New drops', cta_text: 'Shop', link_url: '#cat=makeup', sort_order: 20, active: true },
    { id: 2, image_url: '', title: '', sort_order: 10, active: true },
    { id: 3, image_url: 'https://x/h3.jpg', title: 'Off', sort_order: 5, active: false }
  ];
  const promos = B.heroPromos(rows);
  assert.deepEqual(promos.map(p => p.id), ['beauty-hero-1']);
  assert.equal(promos[0].meta, 'New drops');
  assert.equal(promos[0].href, '#cat=makeup');
  const s = B.settingsMap([{ key: 'background_url', value: 'https://x/bg.jpg' }, { key: 'background_enabled', value: '0' }]);
  assert.equal(B.backgroundUrl(s), '');
  s.background_enabled = '1';
  assert.equal(B.backgroundUrl(s), 'https://x/bg.jpg');
  assert.equal(B.slugify("Men's Grooming"), 'mens-grooming');
});

/* ── BeautyWorld (jsdom mount smoke) ─────────────────────────────── */

test('beauty world: page structure, no bottom nav, real grid + counts', () => {
  const w = bootWindow();
  const el = w.document.getElementById('wp');
  const inst = mountWorld(w);
  const $ = s => el.querySelector(s);
  const $$ = s => [...el.querySelectorAll(s)];

  assert.ok($('.bw-searchbtn'), 'premium search bar present');
  assert.ok($('[data-bw="search"]'), 'search icon in header');
  assert.ok($('[data-bw="favs"]') && $('[data-bw="cart"]') && $('[data-bw="profile"]'), 'existing fav/cart/profile actions');
  assert.equal($$('.bw-tile').length, 4, 'active tiles only');
  assert.equal($$('[data-bw-chips-inline] .bw-chip').length, 5, 'All/Newest/Popular/Man/Kids (no Woman — no such category)');
  assert.equal($('[data-bw-count]').textContent, '3 products', 'real count');
  assert.equal($$('[data-bw-grid] .bw-card').length, 3, 'only real Beauty products in the grid');
  assert.equal($$('.bw-card').length, 6, 'grid (3) + New In rail (3) — the same real products');
  assert.ok(!el.textContent.includes('iPhone 15'), 'non-Beauty products stay out');
  /* no bottom navigation: nothing visible is pinned to the bottom edge */
  $$('*').forEach(node => {
    const cs = w.getComputedStyle(node);
    if (cs.display === 'none') return;
    assert.ok(!(cs.position === 'fixed' && cs.bottom === '0px'), 'no bottom-fixed nav');
  });
  inst.destroy();
  assert.equal(el.innerHTML, '');
});

test('beauty world: category tile + filters change the grid', () => {
  const w = bootWindow();
  const el = w.document.getElementById('wp');
  const inst = mountWorld(w);
  const $ = s => el.querySelector(s);

  const gname = () => el.querySelector('[data-bw-grid] .bw-card-name').textContent;
  const gcards = () => el.querySelectorAll('[data-bw-grid] .bw-card');

  [...el.querySelectorAll('.bw-tile')].find(t => t.textContent.includes('Makeup')).click();
  assert.equal(gcards().length, 1, "tile shows only that category's real products");
  assert.equal($('[data-bw-count]').textContent, 'Clear 1 product');

  $('[data-bw-filter="new"]').click();
  assert.equal(gcards().length, 3);
  assert.equal(gname(), 'Viva Glam Lipstick', 'newest first (real created_at)');

  $('[data-bw-filter="best"]').click();
  assert.equal(gname(), 'Viva Glam Lipstick', 'no real stats -> falls back to newest, never faked');

  $('[data-bw-filter="man"]').click();
  assert.equal(gcards().length, 1);
  assert.equal(gname(), 'Men Beard Oil');
  inst.destroy();
});

test('beauty world: popularity ranks real sales first', () => {
  const w = bootWindow();
  const el = w.document.getElementById('wp');
  mountWorld(w, { stats: { 13: { sold: 5, reviews: 0 }, 14: { sold: 0, reviews: 1 } } });
  const $ = s => el.querySelector(s);
  $('[data-bw-filter="best"]').click();
  const names = [...el.querySelectorAll('[data-bw-grid] .bw-card-name')].map(n => n.textContent);
  assert.deepEqual(names, ['Men Beard Oil', 'Kids Shampoo', 'Viva Glam Lipstick']);
});

test('beauty world: search overlay finds real beauty products only', () => {
  const w = bootWindow();
  const el = w.document.getElementById('wp');
  const inst = mountWorld(w);
  const $ = s => el.querySelector(s);

  $('[data-bw="search"]').click();
  assert.ok(!$('[data-bw-spage]').hidden, 'search overlay opens');
  const input = $('.bw-sp-input');
  input.value = 'lipstick';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  /* the suggest is debounced */
  return new Promise(res => setTimeout(() => {
    const items = [...el.querySelectorAll('[data-bw-spage] .bw-sp-item')];
    assert.equal(items.length, 1);
    assert.ok(items[0].textContent.includes('Viva Glam Lipstick'));
    assert.ok(!el.textContent.includes('iPhone'));
    items[0].click();
    assert.equal(w.__opened, 11, 'opens the existing product page');
    inst.destroy();
    res();
  }, 200));
});

test('beauty world: cutout photo used on cards when present; empty state when no products', () => {
  const w = bootWindow();
  const el = w.document.getElementById('wp');
  prods[0].beauty_image_url = 'https://x/cutout.png';
  const inst1 = mountWorld(w);
  assert.equal(el.querySelector('[data-bw-grid] .bw-card-img img').getAttribute('src'), 'https://x/cutout.png');
  delete prods[0].beauty_image_url;
  inst1.destroy();

  /* empty pool -> clean empty state, no faked products */
  const w2 = bootWindow();
  w2.allProds = [];
  const el2 = w2.document.getElementById('wp');
  const inst2 = w2.Pcx.BeautyWorld.mount(el2, { slug: 'beauty', name: 'Beauty', gradient: '' }, {
    onBack: () => {},
    beauty: {
      heroes: [], cats: beautyCats, settings: { background_url: '', background_enabled: '1' }, stats: {},
      catTree: new w2.Pcx.Categories.Tree(catRows), products: [], vendors: {}, brands: [], brandById: {}, ratings: {}, fmt: n => 'N' + n
    }
  });
  assert.equal(el2.querySelectorAll('.bw-card').length, 0);
  assert.ok(el2.textContent.includes('No beauty products yet'));
  inst2.destroy();
});

/* ── /api/remove-bg.js helpers (no network) ──────────────────────── */

test('remove-bg api: source URL allowlist + deterministic cache path', () => {
  const old = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://qmwlphribvncdtgzbixt.supabase.co';
  const handler = require('../api/remove-bg.js');
  const t = handler.__test;
  try {
    assert.ok(t.isAllowedSourceUrl('https://qmwlphribvncdtgzbixt.supabase.co/storage/v1/object/public/avatars/beauty-hero/x.jpg'));
    assert.ok(!t.isAllowedSourceUrl('https://evil.example.com/storage/v1/object/public/avatars/x.jpg'), 'other hosts blocked');
    assert.ok(!t.isAllowedSourceUrl('http://qmwlphribvncdtgzbixt.supabase.co/storage/v1/object/public/avatars/x.jpg'), 'http blocked');
    assert.ok(!t.isAllowedSourceUrl('https://qmwlphribvncdtgzbixt.supabase.co/rest/v1/products'), 'non-storage paths blocked');
    assert.ok(!t.isAllowedSourceUrl('not a url'));
    const a = t.cachePath('https://x/same.png');
    const b = t.cachePath('https://x/same.png');
    assert.equal(a, b, 'same image -> same cache path (never reprocessed)');
    assert.ok(a.startsWith(t.CUTOUT_DIR + '/'));
    assert.notEqual(a, t.cachePath('https://x/other.png'));
  } finally {
    if (old === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = old;
  }
});

test('remove-bg api: rejects a call with no session, and a non-vendor signed-in user (it can spend paid credits)', async () => {
  const { setVerifier } = require('../api/_lib/auth.js');
  const handler = require('../api/remove-bg.js');
  const old = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  const url = 'https://x.supabase.co/storage/v1/object/public/avatars/beauty-hero/a.jpg';
  const res = () => { const r = { status(s) { r.code = s; return r; }, json(b) { r.body = b; return r; } }; return r; };
  try {
    setVerifier(async () => null);   // no session at all
    let r = res();
    await handler({ method: 'POST', headers: {}, body: { url } }, r);
    assert.equal(r.code, 401);
    assert.ok(r.body && r.body.error);

    setVerifier(async () => ({ id: 'random-customer', email: 'customer@example.com' }));   // signed in, but not an admin or a vendor at all
    const { setDb } = require('../api/_lib/db.js');
    setDb({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) });
    r = res();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { url } }, r);
    assert.equal(r.code, 403, 'a plain signed-in customer cannot spend remove.bg credits');

    setVerifier(async () => ({ id: 'vendor-1', email: 'vendor@example.com' }));   // a real, approved vendor: allowed
    setDb({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: 'approved' }, error: null }) }) }) }) });
    r = res();
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { url } }, r);
    assert.notEqual(r.code, 401); assert.notEqual(r.code, 403);
  } finally {
    require('../api/_lib/db.js').setDb(null);
    setVerifier(async (token) => { const { db } = require('../api/_lib/db.js'); const { data, error } = await db().auth.getUser(token); return (error || !data || !data.user) ? null : data.user; });
    if (old === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = old;
  }
});
