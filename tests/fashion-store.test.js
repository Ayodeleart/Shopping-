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
  'components/fashion.js', 'components/variants.js', 'components/fashion-world.js', 'components/ad-page.js', 'data/ads.js',
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

/* ------------------------------------------------------------------ colours + variants, card, bot (this change) */
const VARIANT_PRODUCTS = [
  { id: 10, name: 'Ankara Tote', price: 3000, stock: 4, category_id: 100, category: 'Plays!', vendor_id: 'v1', image_url: 'https://x/10.jpg',
    attributes: { colors: ['Black', 'Red'] }, created_at: '2026-01-06' },
  { id: 11, name: 'Classic Tee', price: 4500, stock: 9, category_id: 100, category: 'Plays!', vendor_id: 'v1', image_url: 'https://x/11.jpg',
    attributes: { colors: ['Black', 'White'], sizes: { system: 'Letter (XS-XXL)', values: ['M', 'XL'] } }, created_at: '2026-01-07' },
  { id: 12, name: 'Plain Mug', price: 1200, stock: 20, category_id: 102, category: 'Electronics', vendor_id: 'v2', image_url: 'https://x/12.jpg',
    attributes: {}, created_at: '2026-01-08' }
];
const withVariants = () => { const t = TABLES(); t.products = t.products.concat(VARIANT_PRODUCTS.map(p => ({ ...p }))); return t; };
const cartLines = w => JSON.parse(w.localStorage.getItem('cart_v3') || '[]');

test('card: photo fills a fixed media box, heart sits on the photo, no vendor on the card, button always says Add to Cart, swatches show real colours', async t => {
  const w = await boot(withVariants(), null, t);
  const box = w.document.createElement('div');
  box.innerHTML = [10, 12].map(id => w.cardHTML(VARIANT_PRODUCTS.find(p => p.id === id))).join('');
  const [tote, mug] = box.querySelectorAll('.pcard');
  for (const c of [tote, mug]) {
    assert.ok(c.querySelector('.pcImg .favBtn'), 'heart is inside the image box');
    assert.equal(c.querySelector('.pcBody .favBtn'), null, 'heart is not in the text area');
    assert.equal(c.querySelector('.pcSeller'), null, 'no vendor on the card');
    assert.ok(!/Ada Threads|Kano Kicks|Sold by/.test(c.textContent), 'no vendor name anywhere on the card');
    assert.ok(c.querySelector('.favBtn').getAttribute('aria-label'), 'heart is labelled');
    assert.equal(c.querySelector('.pcAdd').textContent.trim(), 'Add to Cart', 'button always says Add to Cart, never "Choose options"');
  }
  assert.equal(tote.querySelectorAll('.pcSwatch').length, 2, 'Ankara Tote has 2 real colours (Black, Red)');
  assert.equal(mug.querySelector('.pcSwatches'), null, 'no colours on a plain product, so no swatch row');
  const css = fs.readFileSync(path.join(ROOT, 'components/product-card.css'), 'utf8');
  assert.match(css, /\.pcImg img\{[^}]*object-fit:cover/, 'image fills the box');
  assert.match(css, /\.pcCtl\{margin-top:auto/, 'buttons are pinned to the card bottom');
  assert.doesNotMatch(css, /\.pcImg img\{[^}]*padding:/, 'no artificial padding around the photo');
});

test('variants: tapping Add to Cart on a card with colours opens the bottom sheet, not the product page', async t => {
  const w = await boot(withVariants(), null, t);
  w.addToCart(10, null, 1, true);                             // from a card: no choices made yet
  assert.equal(cartLines(w).length, 0, 'nothing added yet');
  const sheet = w.document.getElementById('variantSheet');
  assert.ok(sheet.classList.contains('open'), 'the sheet opened');
  assert.equal(w.document.getElementById('pModal').classList.contains('open'), false, 'did not navigate to the product page');
  const chip = sheet.querySelector('.vsChip[data-vs-pick="Black"]');
  assert.ok(chip, 'colour chip is in the sheet');
  chip.click();
  sheet.querySelector('.vsAdd').click();
  const l = cartLines(w);
  assert.equal(l.length, 1);
  assert.equal(l[0].color, 'Black');
  assert.equal(sheet.classList.contains('open'), false, 'sheet closes after adding');
});

test('variants: colour-only product needs a colour on the product page too; add never adds an incomplete product', async t => {
  const w = await boot(withVariants(), null, t);
  w.openProduct(10);
  assert.equal(w.document.getElementById('pColorRow').style.display, '');
  assert.equal(w.document.querySelectorAll('#pColors .pSizeChip').length, 2);
  assert.equal(w.document.getElementById('pSizeRow').style.display, 'none', 'no size selector on a colour-only product');
  w.pAddToCart();
  assert.equal(cartLines(w).length, 0, 'blocked until a colour is picked');
  assert.ok(w.document.getElementById('pColorRow').classList.contains('miss'));
  w.pickPColor(0);
  assert.equal(w.document.querySelector('#pColors .pSizeChip.on').textContent.trim(), 'Black');
  w.pAddToCart();
  const l = cartLines(w);
  assert.equal(l.length, 1);
  assert.equal(l[0].color, 'Black');
  assert.equal(l[0].size, null);
});

test('variants: colour + size are both required, and different variants are separate cart lines', async t => {
  const w = await boot(withVariants(), null, t);
  w.openProduct(11);
  w.pickPColor(0);                                            // Black, no size yet
  w.pAddToCart();
  assert.equal(cartLines(w).length, 0, 'size still missing');
  w.pickPSize(0, 1);                                          // XL
  w.pAddToCart();                                             // Black / XL
  w.pickPColor(0); w.pickPColor(1);                           // switch to White
  w.pickPSize(0, 1); w.pickPSize(0, 0);                       // switch to M
  w.pAddToCart();                                             // White / M
  w.pickPColor(1); w.pickPColor(0);                           // back to Black
  w.pickPSize(0, 0); w.pickPSize(0, 1);                       // back to XL
  w.pAddToCart();                                             // Black / XL again: merges
  const l = cartLines(w);
  assert.equal(l.length, 2, 'Black/XL and White/M stay separate');
  const bx = l.find(x => x.color === 'Black' && x.size === 'XL'), wm = l.find(x => x.color === 'White' && x.size === 'M');
  assert.equal(bx.qty, 2);
  assert.equal(wm.qty, 1);
  w.openCart();
  const shown = w.document.getElementById('cartItems').textContent;
  assert.match(shown, /Colour: Black \u00b7 Size: XL/);
  assert.match(shown, /Colour: White \u00b7 Size: M/);
});

test('variants: products without options add straight away and show no selectors', async t => {
  const w = await boot(withVariants(), null, t);
  w.addToCart(12, null, 1, true);
  const l = cartLines(w);
  assert.equal(l.length, 1);
  assert.equal(l[0].color, null); assert.equal(l[0].size, null);
  w.openProduct(12);
  assert.equal(w.document.getElementById('pColorRow').style.display, 'none');
  assert.equal(w.document.getElementById('pSizeRow').style.display, 'none');
});

test('bot: MAC tucks away while the page scrolls instead of covering products', async t => {
  const w = await boot(withVariants(), null, t);
  const el = w.document.querySelector('.macFab');
  assert.ok(el, 'MAC is still mounted');
  w.document.dispatchEvent(new w.Event('scroll', { bubbles: false }));
  assert.ok(el.classList.contains('isPeek'), 'tucked while scrolling');
  assert.match(fs.readFileSync(path.join(ROOT, 'components/mac-fab.css'), 'utf8'), /\.macFab\.isPeek\s*\{[^}]*translate:/);
});

test('card: tapping a colour swatch shows the linked product photo, and clears back on deselect', async t => {
  const tables = withVariants();
  tables.products = tables.products.map(p => p.id === 10 ? { ...p, image_url: 'https://x/base.jpg', attributes: { colors: ['Black', 'Red'], colorImages: { Red: 'https://x/red.jpg' } } } : p);
  const w = await boot(tables, null, t);
  const box = w.document.createElement('div');
  box.innerHTML = w.cardHTML(tables.products.find(p => p.id === 10));
  w.document.body.appendChild(box);
  const img = box.querySelector('.pcImg img');
  assert.equal(img.src, 'https://x/base.jpg');
  w.pickCardColor(10, 'Black');                     // no linked photo for Black -> stays on the base photo
  assert.equal(img.src, 'https://x/base.jpg');
  w.pickCardColor(10, 'Black');                      // deselect
  w.pickCardColor(10, 'Red');                        // Red has a linked photo
  assert.equal(img.src, 'https://x/red.jpg');
  w.pickCardColor(10, 'Red');                         // deselect again -> back to base
  assert.equal(img.src, 'https://x/base.jpg');
  box.remove();
});

test('favourites: favouriting a product shows the confirmation sheet, and "View Favourites" opens the list', async t => {
  const w = await boot(withVariants(), null, t);
  w.toggleFav(12);                                              // Plain Mug: no variants, simplest case
  const sheet = w.document.getElementById('favSheet');
  assert.ok(sheet, 'sheet was created');
  assert.ok(sheet.classList.contains('open'), 'sheet opened on favouriting');
  assert.match(sheet.querySelector('.fvOk').textContent, /Saved to Favourites/);
  assert.equal(sheet.querySelector('.vsName').textContent, 'Plain Mug');
  const spy = t.mock.method(w, 'showFavorites');
  sheet.querySelector('.fvView').click();
  assert.equal(sheet.classList.contains('open'), false, 'sheet closes on View Favourites');
  assert.equal(spy.mock.calls.length, 1, 'View Favourites opens the existing Favorites list, not a second system');
});

test('favourites: un-favouriting does not reopen the sheet; #favorites deep-links to the same list', async t => {
  const w = await boot(withVariants(), null, t);
  w.toggleFav(12);
  w.Pcx.FavoriteSheet.close();
  w.toggleFav(12);                                              // un-favourite
  assert.equal(w.document.getElementById('favSheet').classList.contains('open'), false, 'no sheet when removing a favourite');
  const spy = t.mock.method(w, 'showFavorites');
  w.location.hash = '#favorites';
  w.dispatchEvent(new w.Event('hashchange'));
  assert.equal(spy.mock.calls.length, 1, '#favorites opens the Favorites list (works as a deep link from the storefront too)');
});
