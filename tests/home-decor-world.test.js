const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

const CATS = [
  { id: 100, parent_id: null, slug: 'home', name: 'Home & Decor', is_active: true, sort_order: 1 },
  { id: 101, parent_id: 100, slug: 'sofas', name: 'Sofas', is_active: true, sort_order: 1 },
  { id: 102, parent_id: 100, slug: 'lighting', name: 'Lighting', is_active: true, sort_order: 2 },
  { id: 200, parent_id: null, slug: 'phones', name: 'Phones', is_active: true, sort_order: 2 }
];
const PRODUCTS = [
  { id: 1, name: 'Curve Sofa', price: 760000, category_id: 101, category: 'Sofas', vendor_id: 'v1', brand: 'Ola', stock: 3, featured: true,
    image_url: 'https://x/original-sofa.jpg', images: ['https://x/original-sofa.jpg'], attributes: { _home_image_url: 'https://x/sofa-cutout.png' }, created_at: '2026-09-03' },
  { id: 2, name: 'Linen Lamp', price: 42000, category_id: 102, category: 'Lighting', vendor_id: null, stock: 6,
    image_url: 'https://x/lamp.jpg', images: ['https://x/lamp.jpg'], attributes: {}, created_at: '2026-09-02' },
  { id: 3, name: 'Not Furniture', price: 90000, category_id: 200, category: 'Phones', stock: 2,
    image_url: 'https://x/phone.jpg', images: ['https://x/phone.jpg'], attributes: {}, created_at: '2026-09-01' }
];
const CONFIG = {
  heroes: [
    { id: 1, title: 'Make room for living', subtitle: 'Furniture for real homes', image_url: 'https://x/room.jpg', cta_type: 'category', cta_label: 'Shop sofas', cta_value: 'sofas' },
    { id: 2, title: 'A softer light', subtitle: '', image_url: 'https://x/light.jpg', cta_type: 'none' }
  ],
  cats: [
    { id: 51, name: 'Living room', image_url: 'https://x/living.jpg', gif_url: '', categoryIds: [101] },
    { id: 52, name: 'Lighting', image_url: '', gif_url: '', categoryIds: [102] }
  ]
};

function boot() {
  const dom = new JSDOM('<!doctype html><body><header id="hdr"><button id="hdrSearchBtn"></button></header><div id="worldPage"></div></body>', {
    url: 'https://shop.test/#world=home', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.Element.prototype.scrollTo = function () {};
  ['data/safe.js', 'data/categories.js', 'components/world-sections.js', 'data/home-decor.js',
    'components/home-decor-world.js', 'components/world-page.js'].forEach(f => w.eval(read(f)));
  return { dom, w };
}

function context(w, products = PRODUCTS) {
  const tree = new w.Pcx.Categories.Tree(CATS);
  const calls = { categories: [], worldCategories: [], products: [], stores: [] };
  const ctx = {
    sb: {}, tree: () => tree, products: () => products,
    vendors: () => ({ v1: { id: 'v1', business_name: 'Ola Living', store_slug: 'ola-living' } }),
    storeName: () => 'Marcato',
    cardHTML(p, opts) {
      return '<div class="pcard' + (opts && opts.compact ? ' pcard-compact' : '') + '" data-pid="' + p.id + '">' +
        '<div class="pcImg"><img src="' + p.image_url + '"></div><div class="pcName">' + p.name + '</div>' +
        (opts && opts.compact ? '' : '<div class="pcCtl"><button class="pcAdd">Add to Cart</button></div>') + '</div>';
    },
    openProduct: id => calls.products.push(id), openStore: id => calls.stores.push(id),
    openCategory: slug => calls.categories.push(slug), openWorldCategory: id => calls.worldCategories.push(id), onBack() {}
  };
  return { ctx, calls };
}

test('Home & Decor world opens through the existing WorldPage route and uses only real eligible Marcato products', async () => {
  const { dom, w } = boot();
  try {
    const { ctx, calls } = context(w);
    w.Pcx.WorldSections.load = async () => CONFIG;
    const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, ctx });
    page.open({ slug: 'home', name: 'Home & Decor', gradient: 'green' });
    await settle();

    const root = w.document.getElementById('worldPage');
    assert.ok(root.classList.contains('open') && root.classList.contains('world-home'));
    assert.ok(w.document.body.classList.contains('home-world-open'), 'shared Marcato header mode is active');
    assert.equal(root.querySelector('.wp-hdr-ttl').textContent, 'Home & Decor');
    assert.equal(root.querySelectorAll('.hd-hero-slide').length, 2, 'admin hero slides persisted into the custom hero');
    assert.deepEqual([...root.querySelectorAll('.hd-category-label strong')].map(e => e.textContent), ['Living room', 'Lighting']);

    const ids = [...root.querySelectorAll('.hd-product-grid [data-home-product]')].map(e => Number(e.dataset.homeProduct));
    assert.deepEqual(ids, [1, 2], 'linked Home category descendants only; unrelated phone is excluded');
    assert.ok(root.querySelectorAll('.hd-product-grid .pcAdd').length === 2, 'standard two-column grid keeps Add to Cart');
    assert.equal(root.querySelectorAll('.hd-featured .pcAdd,.hd-collection .pcAdd').length, 0, 'curated sections use compact cards without Add to Cart');
    assert.equal(root.querySelectorAll('[data-bottom-nav],.bottom-nav,.shop-bottom-nav').length, 0, 'no bottom navigation');

    const sofaImages = [...root.querySelectorAll('[data-home-product="1"] .pcImg img')];
    assert.ok(sofaImages.length && sofaImages.every(i => i.getAttribute('src') === 'https://x/sofa-cutout.png'));
    assert.ok(root.querySelector('[data-home-product="1"].has-cutout'), 'processed furniture gets the warm surface/shadow presentation');
    assert.match(root.textContent, /Ola · Ola Living/, 'real brand and vendor attribution shown');

    root.querySelector('.hd-hero-cta').click();
    assert.deepEqual(calls.categories, ['sofas'], 'admin hero destination uses Marcato category routing');
    root.querySelector('[data-hd-category="51"]').click();
    assert.deepEqual(calls.worldCategories, [51], 'collection tile uses the existing world-category route');

    page.close();
    assert.ok(!w.document.body.classList.contains('home-world-open'));
  } finally { dom.window.close(); }
});

test('Home data helpers follow live world links, preserve originals and store processed URLs in existing attributes JSON', async () => {
  const { dom, w } = boot();
  try {
    const tree = new w.Pcx.Categories.Tree(CATS);
    assert.equal(w.Pcx.HomeDecor.isCategory(tree, 101, [100]), true, 'linked parent includes descendants');
    assert.equal(w.Pcx.HomeDecor.isCategory(tree, 200, [100]), false);
    const original = PRODUCTS[0];
    const display = w.Pcx.HomeDecor.displayProduct(original);
    assert.equal(display.image_url, 'https://x/sofa-cutout.png');
    assert.equal(original.image_url, 'https://x/original-sofa.jpg', 'catalogue original is never overwritten');
    const attrs = w.Pcx.HomeDecor.withProcessedImage({ material: 'Linen' }, 'https://x/cached.png');
    assert.deepEqual(JSON.parse(JSON.stringify(attrs)), { material: 'Linen', _home_image_url: 'https://x/cached.png' });
    assert.deepEqual(JSON.parse(JSON.stringify(w.Pcx.HomeDecor.withProcessedImage(attrs, null))), { material: 'Linen' });

    const tables = {
      world_display_categories: [{ id: 8, world_slug: 'home', is_active: true }, { id: 9, world_slug: 'food', is_active: true }],
      world_category_links: [{ display_category_id: 8, category_id: 100 }, { display_category_id: 9, category_id: 200 }]
    };
    function query(table) {
      let rows = tables[table].slice();
      const q = { select() { return q; }, eq(k, v) { rows = rows.filter(r => r[k] === v); return q; }, in(k, vals) { rows = rows.filter(r => vals.includes(r[k])); return q; }, then(ok) { return Promise.resolve({ data: rows, error: null }).then(ok); } };
      return q;
    }
    assert.deepEqual(JSON.parse(JSON.stringify(await w.Pcx.HomeDecor.linkedCategoryIds({ from: query }))), [100]);
  } finally { dom.window.close(); }
});

test('Wood-derived server compositor keeps furniture pixels/proportions and adds a transparent contact shadow', async () => {
  const sharp = require('sharp');
  const handler = require('../api/remove-bg.js');
  const width = 60, height = 60;
  const furniture = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: 26, height: 32, channels: 4, background: { r: 120, g: 72, b: 40, alpha: 1 } } }, left: 17, top: 5 }])
    .png().toBuffer();
  const output = await handler.__test.addGroundShadow(furniture);
  const meta = await sharp(output).metadata();
  assert.equal(meta.width, width); assert.equal(meta.height, height); assert.ok(meta.hasAlpha, 'transparent canvas is preserved');
  const raw = await sharp(output).ensureAlpha().raw().toBuffer();
  const pixel = (x, y) => [...raw.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.deepEqual(pixel(30, 12), [120, 72, 40, 255], 'furniture colour/texture pixels are untouched');
  assert.ok(pixel(30, 48)[3] > 0 && pixel(30, 48)[3] < 180, 'soft semi-transparent contact shadow exists below the object');
  assert.equal(pixel(2, 2)[3], 0, 'background remains transparent for the warm card surface');
  assert.match(handler.__test.cachePath('https://x/source.jpg'), /^product-cutouts-v2\/[a-f0-9]{64}\.png$/);
  assert.equal(handler.__test.cachePath('https://x/source.jpg'), handler.__test.cachePath('https://x/source.jpg'), 'processed result is deterministic and reusable');
});

test('remove-bg reuses/upgrades cached cutouts without a paid request and fails safely to the original', async () => {
  const sharp = require('sharp');
  const handler = require('../api/remove-bg.js');
  const { setDb } = require('../api/_lib/db.js');
  const { setVerifier } = require('../api/_lib/auth.js');
  const old = { fetch: global.fetch, sb: process.env.SUPABASE_URL, key: process.env.REMOVE_BG_API_KEY, admins: process.env.ADMIN_EMAIL };
  const source = 'https://store.test/storage/v1/object/public/avatars/products/chair.png';
  const png = await sharp({ create: { width: 24, height: 24, channels: 4, background: { r: 90, g: 50, b: 30, alpha: 1 } } }).png().toBuffer();
  const response = () => { const r = { status(n) { r.code = n; return r; }, json(body) { r.body = body; return r; } }; return r; };
  try {
    process.env.SUPABASE_URL = 'https://store.test';
    process.env.REMOVE_BG_API_KEY = 'server-secret';
    process.env.ADMIN_EMAIL = 'admin@store.test';
    setVerifier(async () => ({ id: 'admin', email: 'admin@store.test' }));

    const uploads = [];
    const bucket = {
      exists: async p => ({ data: p.startsWith('beauty-cutouts/') }),
      download: async () => ({ data: new Blob([png]), error: null }),
      upload: async (p, bytes) => { uploads.push({ p, bytes }); return { error: null }; },
      getPublicUrl: p => ({ data: { publicUrl: 'https://cdn.test/' + p } })
    };
    setDb({ storage: { from: () => bucket } });
    let fetches = 0; global.fetch = async () => { fetches++; throw new Error('paid API must not run'); };
    let res = response();
    await handler({ method: 'POST', body: { url: source }, headers: { authorization: 'Bearer test' } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.upgraded, true); assert.equal(res.body.cached, true);
    assert.equal(fetches, 0, 'legacy transparent result is promoted locally without remove.bg');
    assert.equal(uploads.length, 1); assert.match(uploads[0].p, /^product-cutouts-v2\//);

    bucket.exists = async () => ({ data: false });
    global.fetch = async url => {
      if (String(url) === source) return { ok: true, headers: { get: () => String(png.byteLength) }, arrayBuffer: async () => png };
      return { ok: false, status: 503, json: async () => ({ errors: [{ title: 'temporarily unavailable' }] }) };
    };
    res = response();
    await handler({ method: 'POST', body: { url: source }, headers: { authorization: 'Bearer test' } }, res);
    assert.equal(res.code, 502); assert.equal(res.body.url, null);
    assert.equal(uploads.length, 1, 'a service failure never replaces/saves over the original upload');
  } finally {
    global.fetch = old.fetch;
    setDb(null);
    setVerifier(async token => { const { db } = require('../api/_lib/db.js'); const { data, error } = await db().auth.getUser(token); return (error || !data || !data.user) ? null : data.user; });
    if (old.sb === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = old.sb;
    if (old.key === undefined) delete process.env.REMOVE_BG_API_KEY; else process.env.REMOVE_BG_API_KEY = old.key;
    if (old.admins === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old.admins;
  }
});

test('Wood collection rail converts vertical travel to horizontal movement and has a native small/mobile fallback', () => {
  const { dom, w } = boot();
  try {
    const { ctx } = context(w);
    const timers = [];
    w.setTimeout = fn => { timers.push(fn); return timers.length; };
    w.requestAnimationFrame = fn => { fn(); return 1; };
    const page = w.document.getElementById('worldPage');
    const host = w.document.createElement('div'); page.appendChild(host);
    w.Pcx.HomeDecorWorld.mount(host, { slug: 'home', name: 'Home & Decor' }, { heroes: [], cats: [{ id: 51, name: 'Living room', categoryIds: [101] }] }, ctx);
    const rail = host.querySelector('[data-hd-rail]');
    const viewport = rail.querySelector('.hd-rail-viewport');
    const track = rail.querySelector('.hd-rail-track');
    Object.defineProperty(track, 'scrollWidth', { configurable: true, value: 900 });
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 300 });
    page.getBoundingClientRect = () => ({ top: 0 });
    rail.getBoundingClientRect = () => ({ top: -248 });
    timers.shift()();
    assert.equal(rail.style.height, 'calc(100dvh + 600px)');
    page.dispatchEvent(new w.Event('scroll'));
    assert.match(track.style.transform, /translate3d\(-300px,0,0\)/, 'vertical scroll progress moves the rail horizontally');

    Object.defineProperty(track, 'scrollWidth', { configurable: true, value: 330 });
    timers.push(() => {}); // no-op to keep test intent explicit: resize calls measure synchronously
    w.dispatchEvent(new w.Event('resize'));
    assert.ok(rail.classList.contains('is-free'), 'a rail with no horizontal budget becomes native swipe/scroll-snap');
  } finally { dom.window.close(); }
});

test('Home world renders an honest empty state without fabricated products', () => {
  const { dom, w } = boot();
  try {
    const { ctx } = context(w, [PRODUCTS[2]]);
    const host = w.document.createElement('div');
    w.document.getElementById('worldPage').appendChild(host);
    w.Pcx.HomeDecorWorld.mount(host, { slug: 'home', name: 'Home & Decor' }, { heroes: [], cats: [] }, ctx);
    assert.equal(host.querySelectorAll('[data-home-product]').length, 0);
    assert.match(host.querySelector('.hd-empty').textContent, /No Home & Decor products yet/);
  } finally { dom.window.close(); }
});

test('Home hero falls back to real products and its automatic transition advances smoothly', async () => {
  const { dom, w } = boot();
  try {
    const { ctx, calls } = context(w);
    const callbacks = [];
    w.setInterval = fn => { callbacks.push(fn); return callbacks.length; };
    w.clearInterval = () => {};
    const host = w.document.createElement('div');
    w.document.getElementById('worldPage').appendChild(host);
    w.Pcx.HomeDecorWorld.mount(host, { slug: 'home', name: 'Home & Decor' }, { heroes: [], cats: [{ id: 51, name: 'Living', categoryIds: [101] }] }, ctx);
    await settle();
    assert.equal(host.querySelectorAll('.hd-hero-slide').length, 2, 'only real Home products become fallback slides');
    assert.equal(host.querySelector('.hd-hero-slide.is-active .hd-hero-title').textContent, 'Curve Sofa');
    const heroTimer = callbacks[0];
    assert.equal(typeof heroTimer, 'function');
    heroTimer();
    assert.equal(host.querySelector('.hd-hero-slide.is-active .hd-hero-title').textContent, 'Linen Lamp');
    host.querySelector('.hd-hero-slide.is-active .hd-hero-cta').click();
    assert.deepEqual(calls.products, [2], 'fallback slide opens Marcato existing product details');
  } finally { dom.window.close(); }
});
