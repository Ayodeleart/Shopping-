/* Full-storefront Fashion integration test (jsdom + stubbed Supabase, no network).
 * Boots the real index.html with every real component, then checks the Fashion wiring:
 *   • fashion tables load; universe comes from real fashion categories
 *   • #world=fashion opens the Fashion world (gender cards, hero ads, circular categories)
 *   • the main store menu stays free of Fashion-only categories
 *   • product page size selector: required before add-to-cart, size lands on the cart line
 *   • Fashion-scoped search uses the same SearchPage and clears when it closes
 */
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
      getSession: async () => ({ data: { session: null } }),
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
  'components/fashion.js', 'components/fashion-world.js', 'components/ad-page.js', 'data/ads.js',
  'data/categories.js', 'components/category-page.js', 'data/search.js', 'components/search-page.js',
  'data/tracking.js', 'components/order-tracking.js', 'components/notification-center.js',
  'components/mac-theme.js', 'components/mac-fab.js', 'components/mac-chat.js',
  'components/product-gallery.js', 'components/image-viewer.js',
  'components/product-card.js', 'components/seller-brand.js'
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
  { id: 100, parent_id: null, slug: 'plays', name: 'Plays!', sort_order: 1, is_active: true, world: 'fashion', color: '#F3E8D3' },
  { id: 101, parent_id: null, slug: 'shoes-fw', name: 'Shoes', sort_order: 2, is_active: true, world: 'fashion', color: '#eee' },
  { id: 102, parent_id: null, slug: 'electronics', name: 'Electronics', sort_order: 3, is_active: true, world: null }
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
  store_settings: [{ key: 'storeName', value: 'Maccato' }, { key: 'currency', value: '\u20a6' }],
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

/* ------------------------------------------------------------------ tests */
test('boot: fashion universe is real, menu stays clean, fashion world opens at #world=fashion', async t => {
  const w = await boot(TABLES(), null, t);

  // the main store menu must NOT list the Fashion-only categories
  const menuHTML = w.document.getElementById('menuCats').innerHTML;
  assert.ok(!menuHTML.includes('Plays!'));
  assert.ok(menuHTML.includes('Electronics'));

  // open the Fashion world through the same hash route as the Explore card
  w.location.hash = 'world=fashion';
  w.dispatchEvent(new w.Event('hashchange'));
  assert.ok(w.document.getElementById('fashionPage').classList.contains('open'));
  assert.equal(w.document.querySelectorAll('#fashionPage .fw-g').length, 4);
  assert.ok(w.document.querySelector('#fwHero.pcx'));         // hero carousel mounted with the real ads
  const circles = [...w.document.querySelectorAll('#fashionPage .fw-cat')];
  assert.equal(circles.length, 2);                            // Plays! + Shoes circles

  // the shop grid holds ONLY the real fashion products (the Electronics speaker is not one)
  const gridText = w.document.querySelector('#fashionPage .fwGrid').textContent;
  assert.equal(w.document.querySelectorAll('#fashionPage .fwGrid .pcard').length, 2);
  assert.ok(gridText.includes('Pre-loved Denim Jacket'));
  assert.ok(gridText.includes('Leather Loafers'));
  assert.ok(!gridText.includes('Bluetooth Speaker'));
  assert.ok(w.document.querySelector('#fashionPage .fw-rail'));   // real-data rails render

  // the Fashion search shares the SearchPage, scoped to the fashion universe
  w.document.querySelector('#fashionPage .fw-search').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.ok(w.document.getElementById('searchPage').classList.contains('open'));
  // typing the speaker's name finds nothing there (it is not fashion)
  const input = w.document.querySelector('#searchPage .sp-input');
  input.value = 'Bluetooth';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  assert.equal(w.document.querySelectorAll('#searchPage .spcard, #searchPage [data-open-product]').length, 0);
  // close it (back arrow) — scope must clear
  w.document.querySelector('#searchPage .sp-back').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.ok(!w.document.getElementById('searchPage').classList.contains('open'));

  // back closes the fashion world
  w.location.hash = '';
  w.dispatchEvent(new w.Event('hashchange'));
  assert.ok(!w.document.getElementById('fashionPage').classList.contains('open'));
});

test('size selection: chips render, add-to-cart is blocked until a size is picked, size lands on the cart line', async t => {
  const w = await boot(TABLES(), null, t);
  w.openProduct(2);                                           // Leather Loafers, EU sizes
  assert.equal(w.document.getElementById('pSizeRow').style.display, '');
  assert.equal(w.document.querySelectorAll('#pSizes .pSizeChip').length, 3);

  w.pAddToCart();                                             // no size picked yet
  assert.equal(JSON.parse(w.localStorage.getItem('cart_v3') || '[]').length, 0);   // blocked
  assert.ok(w.document.getElementById('pSizeRow').classList.contains('miss'));

  w.pickPSize(0, 1);                                          // EU 42
  w.pAddToCart();
  let lines = JSON.parse(w.localStorage.getItem('cart_v3') || '[]');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].size, '42');

  // speaker has no sizes: card add works with no size and no selector appears
  w.closePModal(true);
  w.addToCart(3, null, 1, true);
  lines = JSON.parse(w.localStorage.getItem('cart_v3') || '[]');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].size, null);
  w.openProduct(3);
  assert.equal(w.document.getElementById('pSizeRow').style.display, 'none');
});
