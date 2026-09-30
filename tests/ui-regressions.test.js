const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ fake supabase */
function makeSb(tables) {
  function builder(table) {
    let rows = (tables[table] || []).slice();
    const q = {
      select() { return q; },
      eq(c, v) { rows = rows.filter(r => r[c] === v); return q; },
      order() { return q; },
      range() { return q; },
      limit() { return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      in() { return q; }, neq() { return q; }, gte() { return q; }, lte() { return q; }, is() { return q; },
      upsert() { return Promise.resolve({ data: null, error: null }); },
      insert() { return Promise.resolve({ data: null, error: null }); },
      update() { return Promise.resolve({ data: null, error: null }); },
      delete() { return Promise.resolve({ data: null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); }
    };
    return q;
  }
  return {
    from: t => builder(t),
    rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'place_order missing' } }),
    auth: {
      getSession: async () => ({ data: { session: global.__SESSION || null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } })
  };
}

/* ------------------------------------------------------------------ boot */
const LOCAL_SCRIPTS = [
  'data/safe.js', 'components/drag-gesture.js', 'components/promotion-slide.js',
  'components/promotional-carousel.js', 'data/promotions.js', 'components/tile-row.js',
  'data/buyer.js', 'components/address-search.js', 'components/checkout-page.js', 'components/profile-page.js',
  'data/worlds.js', 'components/explore-marcato.js', 'components/world-page.js',
  'components/food-world.js', 'data/food-pairings.js', 'components/food-pairing-ui.js',
  'data/beauty.js', 'components/beauty-world.js',
  'components/fashion.js', 'components/variants.js', 'components/fashion-world.js', 'components/ad-page.js', 'data/ads.js',
  'data/categories.js', 'components/category-page.js', 'data/search.js', 'components/search-page.js',
  'data/tracking.js', 'components/order-tracking.js', 'components/notification-center.js',
  'components/mac-theme.js', 'components/mac-fab.js', 'components/mac-chat.js',
  'components/product-gallery.js', 'components/image-viewer.js',
  'components/product-card.js', 'components/brand-strip.js', 'components/seller-brand.js'
];

async function boot(tables, hash, t) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const body = html
    .replace(/<script src="https:[^"]+"><\/script>/g, '')
    .replace(/<script src="[^"]*sw-register\.js"><\/script>/, '')
    .replace(/<script>window\.MAC_FAB_MANUAL[^<]*<\/script>/, '');
  const doc = body.slice(body.indexOf('<!'), body.indexOf('</html>'));

  const dom = new JSDOM(doc, { url: 'https://shop.test/' + (hash || ''), runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.Element.prototype.scrollIntoView = function () {};
  w.scrollTo = () => {};
  /* don't let the page's polling timers keep the node process alive */
  const _setInterval = w.setInterval.bind(w);
  w.setInterval = (fn, ms, ...rest) => { const t = _setInterval(fn, ms, ...rest); if (t && t.unref) t.unref(); return t; };
  w.supabase = { createClient: () => makeSb(tables) };

  /* One combined eval: classic <script> pages share top-level let/const across files,
     while separate indirect evals would scope them apart. */
  const inline = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n')
    .replace("document.addEventListener('DOMContentLoaded', init);", '/* init is called by the test */');
  w.eval(LOCAL_SCRIPTS.map(s => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n;\n') + '\n;\n' + inline);
  await w.init();
  await new Promise(r => setTimeout(r, 20));
  if (t) t.after(() => w.close());   /* shut the jsdom window down so the test run exits */
  return w;
}

/* ------------------------------------------------------------------ fixtures */
const FASHION_CATS = [
  { id: 99, parent_id: null, slug: 'fashion-clothing', name: 'Fashion & Clothing', sort_order: 1, is_active: true, color: '#F3E8D3' },
  { id: 100, parent_id: 99, slug: 'plays', name: 'Plays!', sort_order: 1, is_active: true, color: '#F3E8D3' },
  { id: 101, parent_id: 99, slug: 'shoes-fw', name: 'Shoes', sort_order: 2, is_active: true, color: '#eee' },
  { id: 102, parent_id: null, slug: 'electronics', name: 'Electronics', sort_order: 3, is_active: true }
];
const PRODUCTS = [
  { id: 1, name: 'Pre-loved Denim Jacket', price: 5000, stock: 3, category_id: 100, category: 'Plays!', vendor_id: 'v1', image_url: 'https://x/1.jpg',
    attributes: { gender: 'Unisex', sizes: { system: 'Letter (XS-XXL)', values: ['M', 'L'] } }, created_at: '2026-01-05' },
  { id: 2, name: 'Leather Loafers', price: 12000, stock: 2, category_id: 101, category: 'Shoes', vendor_id: 'v1', image_url: 'https://x/2.jpg',
    attributes: { gender: 'Men', sizes: { system: 'EU', values: ['41', '42', '43'] } }, created_at: '2026-01-04' },
  { id: 3, name: 'Bluetooth Speaker', price: 9000, stock: 5, category_id: 102, category: 'Electronics', vendor_id: 'v2',
    attributes: {}, created_at: '2026-01-03' }
];

const TABLES = () => ({
  products: PRODUCTS.map(p => ({ ...p })),
  banners: [], shortcuts: [],
  store_settings: [{ key: 'storeName', value: 'Marcato' }, { key: 'currency', value: '\u20a6' }],
  vendors: [
    { id: 'v1', business_name: 'Ada Threads', status: 'approved', store_slug: 'ada-threads', logo_url: '' },
    { id: 'v2', business_name: 'Kano Kicks', status: 'approved', store_slug: 'kano-kicks' }
  ],
  ads: [], tiles: [],
  categories: FASHION_CATS.map(c => ({ ...c })),
  brands: [], product_ratings: [], worlds: [],
  fashion_genders: [
    { slug: 'men', name: 'Men', media_url: 'https://x/men.gif', accent: '#1E2A4A', active: true, sort_order: 1 },
    { slug: 'women', name: 'Women', media_url: null, accent: '#7C2248', active: true, sort_order: 2 },
    { slug: 'boys', name: 'Boys', media_url: null, active: true, sort_order: 3 },
    { slug: 'girls', name: 'Girls', media_url: null, active: true, sort_order: 4 }
  ],
  fashion_ads: [
    { id: 1, title: 'Owambe season', image_url: 'https://x/ad1.gif', href: '', active: true, sort_order: 1 },
    { id: 2, title: 'Plays!', image_url: 'https://x/ad2.png', href: '#cat=plays', active: true, sort_order: 2 }
  ],
  fashion_sections: [],
  notifications: [], push_subscriptions: [], orders: [], order_items: [], reviews: [], favorites: []
});


/* ============================================================================================================
 * Regression tests for the UI regression-fix round: Fashion cards + sticky sort row, heart contrast, Shop by Brand,
 * shared search (Beauty / Home & Decor), Profile back-navigation. (Variant-sheet tests live in fashion-store.test.js.)
 * jsdom does not lay out, so layout guarantees are pinned at the stylesheet level; the visual pass is done on a device.
 * ========================================================================================================== */
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const document_hasHomeBrandHost = w => !!w.document.getElementById('catBrands');

const BRANDED = () => {
  const t = TABLES();
  t.brands = [{ id: 1, name: 'Nike', logo_url: 'https://x/nike.png', active: true }, { id: 2, name: 'Fila', logo_url: '', active: true }, { id: 3, name: 'Unused', logo_url: '', active: true }];
  t.products[0].brand_id = 1; t.products[1].brand_id = 2;
  t.products.push({ id: 6, name: 'Nike Hoodie', price: 8000, stock: 4, category_id: 100, category: 'Plays!', vendor_id: 'v1', image_url: 'https://x/6.jpg',
    brand_id: 1, attributes: { gender: 'Unisex' }, created_at: '2026-01-06' });
  return t;
};

test('Fashion: two-column standard-card grid, equal-height cells, sticky sort row under the 52px header', () => {
  const css = R('components/fashion-world.css');
  assert.match(css, /\.fwGrid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:8px;align-items:stretch/, 'two columns on mobile, like the main store grid');
  assert.match(css, /\.fwGrid \.fcard-wrap > div\{flex:1/, 'the animation wrapper stretches so the one card fills its cell');
  assert.match(css, /\.fwGrid \.fcard-wrap \.pcard\{flex:1;height:auto/, 'cards in a row share one height');
  assert.ok(!/\.fwGrid\{[^}]*repeat\(3/.test(css), 'the cramped three-column mobile grid is gone');
  assert.match(css, /\.fw-sortRow\{\s*position:sticky;top:52px/, 'sort/filter row sticks directly under the Fashion header');
  assert.match(R('components/fashion-world.js'), /h\('div', 'fw-chipRow fw-sortRow'\)/, 'the sort row is the sticky one (not the category chips)');
  /* the ONE standard card: the brand line always reserves its row so prices / swatches / buttons align */
  assert.match(R('components/product-card.css'), /\.pcBrand\{min-height:12\.6px/);
  assert.doesNotMatch(R('components/fashion-world.js'), /function fashionCard|fw-card/, 'no Fashion-only card implementation');
});

test('heart: dark outline on light theme, light outline on dark theme, red filled state untouched (shared control)', () => {
  const css = R('components/product-card.css');
  assert.match(css, /\.pcImg \.favBtn\{color:#1d1d1f\}/);
  assert.match(css, /\[data-theme=dark\] \.pcImg \.favBtn\{background:rgba\(24,24,26,\.72\);color:#f5f5f7/);
  assert.match(css, /\.pcImg \.favBtn\.on\{color:var\(--red\)\}/);
  /* the control is the shared one everywhere: one heart rule, no Beauty-specific recolour */
  assert.ok(!/bw-heart/.test(R('components/beauty-world.css')));
});

test('Shop by Brand (shared strip): only real brands with products, busiest first, logo reused, tap selects / clears', async t => {
  const w = await boot(BRANDED(), null, t);
  const BS = w.Pcx.BrandStrip;
  const brands = { 1: { id: 1, name: 'Nike', logo_url: 'https://x/nike.png' }, 2: { id: 2, name: 'Fila' }, 3: { id: 3, name: 'Unused' } };
  const brandOf = p => brands[p.brand_id] || null;
  const products = [{ id: 1, brand_id: 1 }, { id: 2, brand_id: 1 }, { id: 3, brand_id: 2 }, { id: 4 }, { id: 5, brand: 'Text Brand' }];
  assert.deepEqual(Array.from(BS.collect(products, brandOf), b => b.name + ':' + b.n), ['Nike:2', 'Fila:1', 'Text Brand:1'], 'Unused has no products -> absent; products with no brand add nothing');

  const host = w.document.createElement('div');
  const picks = [];
  const strip = BS.mount(host, { products, brandOf, onSelect: it => picks.push(it && it.name) });
  const chips = () => [...host.querySelectorAll('.bs-brand')];
  assert.equal(chips().length, 3);
  assert.ok(host.querySelector('.bs-brand img[src="https://x/nike.png"]'), 'the existing brand logo is reused');
  assert.ok(host.querySelector('.secHd--accent'), 'uses the shared coloured section header');
  chips()[0].click();
  assert.deepEqual(picks, ['Nike']);
  assert.ok(host.querySelector('.bs-brand.on'));
  host.querySelector('.bs-brand.on').click();                       /* tapping the selected brand clears it */
  assert.deepEqual(picks, ['Nike', null]);
  strip.update([{ id: 9 }]);                                        /* no branded products -> the section disappears, nothing fake */
  assert.ok(host.querySelector('.bs').hidden);
});

test('Fashion world: Shop by Brand lists the brands of the Fashion products and filters the grid in place; cards show the real brand', async t => {
  const w = await boot(BRANDED(), '#world=fashion', t);
  const page = w.document.getElementById('fashionPage');
  await new Promise(r => setTimeout(r, 60));
  const names = () => [...page.querySelectorAll('.fwGrid .pcName')].map(n => n.textContent);
  const brandChips = () => [...page.querySelectorAll('.fw-brands .bs-brand .bs-name')].map(n => n.textContent);
  assert.deepEqual(brandChips(), ['Nike', 'Fila'], 'Nike (2 products) first; the brand with no Fashion product is not shown');
  const all = names().length;
  assert.ok(all >= 3);
  page.querySelector('.fw-brands .bs-brand').click();               /* Nike */
  assert.deepEqual(names().sort(), ['Nike Hoodie', 'Pre-loved Denim Jacket']);
  assert.ok([...page.querySelectorAll('.fwGrid .pcBrand')].every(n => n.textContent === 'Nike'), 'each card shows its actual brand');
  assert.equal(page.querySelectorAll('.fw-sortRow').length, 1, 'still exactly one sticky sort row');
  page.querySelector('.fw-brands .bs-brand.on').click();            /* clear */
  assert.equal(names().length, all);
});

test('category view: Shop by Brand drives the existing brand filter in place', async t => {
  const w = await boot(BRANDED(), null, t);
  w.eval("location.hash = 'cat=plays'");
  w.dispatchEvent(new w.HashChangeEvent('hashchange'));
  await new Promise(r => setTimeout(r, 120));
  const host = w.document.querySelector('.cpg-brands');
  assert.ok(host, 'the category page has a brand section');
  const chips = [...host.querySelectorAll('.bs-brand')];
  assert.ok(chips.length >= 1, 'brands of this category are listed');
  assert.ok(!chips.some(c => c.querySelector('.bs-name').textContent === 'Unused'), 'a brand with no products here is never shown');
  assert.ok(document_hasHomeBrandHost(w), 'the homepage in-place category view has its own brand host');
  assert.ok(chips.every(c => ['Nike', 'Fila'].includes(c.querySelector('.bs-name').textContent)), 'only brands with products here');
});

test('search: Home & Decor keeps its green theme on the shared search page; Beauty scopes the shared search; both reset on close', async t => {
  const w = await boot(BRANDED(), null, t);
  const sp = w.document.getElementById('searchPage');
  w.openWorldSearch('home');
  assert.ok(sp.classList.contains('theme-home'), 'green tokens applied through a class on the ONE shared search page');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!sp.classList.contains('theme-home'), 'the theme does not leak to the main marketplace search');
  w.openWorldSearch('food');
  assert.ok(!sp.classList.contains('theme-home'), 'other worlds are not recoloured');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const css = R('components/home-decor-world.css');
  assert.match(css, /#searchPage\.theme-home\{/);
  assert.equal(w.document.querySelectorAll('#searchPage').length, 1, 'still a single search implementation');
});

test('profile: Back closes only the Profile overlay and returns to the page it was opened from (no reset to Home)', async t => {
  global.__SESSION = { access_token: 't', user: { id: 'u1', email: 'a@b.co', user_metadata: {} } };   /* a signed-in buyer, through the real session path */
  t.after(() => { delete global.__SESSION; });
  const w = await boot(TABLES(), null, t);
  w.history.pushState({}, '', '#world=fashion');                    /* the customer is inside a world */
  const here = w.location.hash;
  const depth = w.history.length;
  w.Pcx.Profile.open();
  assert.ok(w.Pcx.Profile.isOpen());
  assert.equal(w.history.length, depth + 1, 'Profile has ONE history entry of its own');
  assert.equal(w.location.hash, here, 'the URL (world / category) underneath is untouched');
  assert.ok(w.history.state && w.history.state.pcxProfile);

  /* browser / installed-PWA Back: popstate onto the entry below */
  w.history.replaceState({}, '', w.location.href);                  /* what the entry below looks like after the pop */
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: {} }));
  assert.ok(!w.Pcx.Profile.isOpen(), 'Back closed the profile');
  assert.equal(w.location.hash, here, 'and the customer is still where they were — not sent Home');

  /* the app's own close/back button pops the same entry exactly once (no loop, no stale entry left) */
  w.Pcx.Profile.open();
  w.Pcx.Profile.close();
  await new Promise(r => setTimeout(r, 30));
  assert.ok(!w.Pcx.Profile.isOpen());
  assert.equal(w.location.hash, here);

  /* a stale Profile entry with Profile closed is skipped, not shown and not looped */
  let backs = 0; const hb = w.history.back.bind(w.history); w.history.back = () => { backs++; };
  w.dispatchEvent(new w.PopStateEvent('popstate', { state: { pcxProfile: 1 } }));
  assert.equal(backs, 1);
  w.history.back = hb;
});

test('world header: the shared search icon passes the world slug (one search, themed by the host)', () => {
  assert.match(R('components/world-page.js'), /\(d\.openSearch \|\| global\.openSearch \|\| function \(\) \{\}\)\(world\.slug\)/);
  assert.match(R('components/beauty-world.js'), /this\.d\.openSearch\('beauty'\)/);
});
