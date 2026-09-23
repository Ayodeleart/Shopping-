/* Fashion world smoke tests (jsdom, no network):
 *   • Pcx.Fashion helpers: gender matching + size groups from real product attributes
 *   • category tree world scoping (main store vs Fashion world)
 *   • FashionWorld mounting: gender cards, circular categories, real-data rails,
 *     gender filtering, grid/list layout toggle, graceful empty states
 *   • admin rails builder: dedupe + auto rails from real vendors/categories only
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');

function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://store.test/', runScripts: 'outside-only' });
  const w = dom.window;
  w.matchMedia = w.matchMedia || (q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  w.IntersectionObserver = w.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} };
  w.ResizeObserver = w.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
  w.Element.prototype.scrollIntoView = w.Element.prototype.scrollIntoView || function () {};
  w.requestAnimationFrame = w.requestAnimationFrame || (fn => setTimeout(fn, 0));
  return w;
}

function load(w, rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  w.eval(src);
}

function setup() {
  const w = makeWindow();
  load(w, 'data/safe.js');               // esc / safeUrl / hs / num / cssColor
  load(w, 'data/categories.js');         // Pcx.Categories
  load(w, 'components/fashion.js');      // Pcx.Fashion
  return w;
}

const CAT_ROWS = [
  { id: 1, parent_id: null, slug: 'shoes', name: 'Shoes', sort_order: 1, is_active: true, world: 'fashion', color: '#eee' },
  { id: 2, parent_id: null, slug: 'watches', name: 'Watches', sort_order: 2, is_active: true, world: 'both', color: '' },
  { id: 3, parent_id: null, slug: 'phones', name: 'Phones', sort_order: 3, is_active: true, world: null },
  { id: 4, parent_id: 1, slug: 'sneakers', name: 'Sneakers', sort_order: 1, is_active: true, world: null }
];

const PRODUCTS = [
  { id: 10, name: 'Running Sneakers', price: 100, stock: 5, category_id: 4, vendor_id: 'v1', attributes: { gender: 'Men', sizes: { system: 'EU', values: ['40', '41', '42'] } }, created_at: '2026-01-01' },
  { id: 11, name: 'Ankara Gown', price: 200, original_price: 400, stock: 0, category_id: 1, vendor_id: 'v2', attributes: { gender: 'Women' }, featured: true, created_at: '2026-01-02' },
  { id: 12, name: 'Unisex Watch', price: 300, stock: 2, category_id: 2, vendor_id: null, attributes: { gender: 'Unisex' }, created_at: '2026-01-03' },
  { id: 13, name: 'Phone Case', price: 50, stock: 9, category_id: 3, vendor_id: 'v1', attributes: {}, created_at: '2026-01-04' },
  { id: 14, name: 'Waist Beads', price: 20, stock: 4, category_id: 1, vendor_id: 'v2', attributes: { waist: ['30', '32'] }, created_at: '2026-01-05' }
];

test('fashion categories come from the world tag and legacy text still matches', () => {
  const w = setup();
  const tree = new w.Pcx.Categories.Tree(CAT_ROWS);
  const roots = w.Pcx.Fashion.fashionRoots(tree);
  assert.deepEqual(roots.map(c => c.slug).sort(), ['shoes', 'watches']);
  const match = w.Pcx.Fashion.productMatcher(tree);
  const universe = PRODUCTS.filter(match);
  assert.deepEqual(universe.map(p => p.id).sort(), [10, 11, 12, 14]);   // phone case excluded
});

test('visibleRootsIn scopes each surface correctly', () => {
  const w = setup();
  const tree = new w.Pcx.Categories.Tree(CAT_ROWS);
  assert.deepEqual(tree.visibleRootsIn('fashion').map(c => c.slug).sort(), ['shoes', 'watches']);
  assert.deepEqual(tree.visibleRootsIn(null).map(c => c.slug).sort(), ['phones', 'watches']);  // shoes is fashion-only
  assert.deepEqual(tree.visibleRoots().map(c => c.slug).sort(), ['phones', 'shoes', 'watches']); // admin sees everything
});

test('gender matching uses attributes.gender (unisex matches every filter)', () => {
  const w = setup();
  const F = w.Pcx.Fashion;
  assert.equal(F.genderOf(PRODUCTS[0]), 'men');
  assert.equal(F.genderOf(PRODUCTS[2]), 'unisex');
  assert.equal(F.genderOf(PRODUCTS[4]), null);
  assert.equal(F.matchesGender(PRODUCTS[0], 'women'), false);
  assert.equal(F.matchesGender(PRODUCTS[2], 'girls'), true);
  assert.equal(F.matchesGender(PRODUCTS[4], 'men'), false);
  assert.equal(F.matchesGender(PRODUCTS[0], null), true);
});

test('size groups read sizes / waist / band+cups and nothing for products without sizes', () => {
  const w = setup();
  const F = w.Pcx.Fashion;
  assert.deepEqual(F.sizeGroups(PRODUCTS[0]), [{ key: 'size', label: 'Size (EU)', values: ['40', '41', '42'] }]);
  assert.deepEqual(F.sizeGroups(PRODUCTS[4]), [{ key: 'waist', label: 'Waist (inches)', values: ['30', '32'] }]);
  const bra = { attributes: { band: ['32', '34'], cups: ['B', 'C'] } };
  assert.deepEqual(F.sizeGroups(bra), [
    { key: 'band', label: 'Band size', values: ['32', '34'] },
    { key: 'cups', label: 'Cup size', values: ['B', 'C'] }
  ]);
  assert.deepEqual(F.sizeGroups(PRODUCTS[3]), []);   // phone case: no size selector
  assert.equal(F.sizeLabel(['32', 'B']), '32 / B');
});

test('rails are built from real data only and admin rows win over automatic ones', () => {
  const w = setup();
  load(w, 'components/fashion-world.js');
  const tree = new w.Pcx.Categories.Tree(CAT_ROWS);
  const universe = PRODUCTS.filter(w.Pcx.Fashion.productMatcher(tree));
  const vendorsMap = { v1: { id: 'v1', business_name: 'Ada Threads', store_slug: 'ada-threads' }, v2: { id: 'v2', business_name: 'Bola Fits', store_slug: 'bola-fits' } };

  const rails = w.Pcx.FashionWorld.buildRails(tree, universe, vendorsMap, []);
  const titles = rails.map(r => r.title);
  assert.ok(titles.includes('New Fashion Finds'));
  assert.ok(titles.includes('Trending in Fashion'));       // product 11 is featured
  assert.ok(titles.some(t => /Bola Fits/.test(t)));        // top vendor rail with real name
  assert.ok(titles.includes('Shoes'));                     // category rail
  // no fake vendor names anywhere
  rails.forEach(r => { if (r.vendor) assert.ok(['Ada Threads', 'Bola Fits'].includes(r.vendor.business_name)); });

  // an admin row for the same category suppresses the automatic one and uses the custom title
  const admin = [{ id: 1, title: 'Step Out in Style', type: 'category', category_id: 1, item_limit: 5, active: true, sort_order: 1 }];
  const rails2 = w.Pcx.FashionWorld.buildRails(tree, universe, vendorsMap, admin);
  assert.equal(rails2.filter(r => r.title === 'Shoes').length, 0);
  const custom = rails2.find(r => r.title === 'Step Out in Style');
  assert.ok(custom && custom.prods.length && custom.prods.length <= 5);

  // an admin row whose category has no products silently disappears
  const empty = w.Pcx.FashionWorld.buildRails(tree, universe, vendorsMap, [{ id: 2, title: 'Ghost', type: 'category', category_id: 3, active: true, sort_order: 1 }]);
  assert.equal(empty.find(r => r.title === 'Ghost'), undefined);
});

test('FashionWorld mounts gender cards, circles and the shop grid; gender filter really filters', async () => {
  const w = setup();
  load(w, 'components/promotion-slide.js');
  load(w, 'components/drag-gesture.js');
  load(w, 'components/promotional-carousel.js');
  load(w, 'components/fashion-world.js');

  w.document.body.innerHTML = '<div id="fashionPage"></div><div id="fashionCatsPage"></div>';
  const tree = new w.Pcx.Categories.Tree(CAT_ROWS);
  const universe = PRODUCTS.filter(w.Pcx.Fashion.productMatcher(tree));
  const vendorsMap = { v1: { id: 'v1', business_name: 'Ada Threads', store_slug: 'ada-threads', logo_url: '' } };

  const page = new w.Pcx.FashionWorld(w.document.getElementById('fashionPage'), {
    genders: () => [
      { slug: 'men', name: 'Men', media_url: 'https://img.test/men.gif', accent: '#1E2A4A' },
      { slug: 'women', name: 'Women', media_url: '', accent: '#7C2248' }
    ],
    ads: () => [{ id: 1, title: 'Owambe', image_url: 'https://img.test/ad.gif', href: '' }],
    sections: () => [],
    tree: () => tree,
    products: () => universe,
    vendorsMap: () => vendorsMap,
    storeName: () => 'Maccato',
    cardHTML: p => `<div class="pcard" data-pid="${p.id}">${p.name}</div>`,
    onBack() {}, openCart() {}, openSearch() {}, openCategory() {}, openAllCategories() {}, openStore() {},
    afterRender() {}, toast() {}
  });
  page.open();
  assert.ok(page.isOpen());

  // gender cards: active card carries the media and the accent
  const cards = w.document.querySelectorAll('.fw-g');
  assert.equal(cards.length, 2);
  assert.ok(cards[0].classList.contains('has-media'));
  assert.equal(cards[0].querySelector('img').src, 'https://img.test/men.gif');

  // hero ad carousel exists with the real ad
  assert.ok(w.document.querySelector('#fwHero'));

  // circular categories: only fashion-scoped ones, media inside the circle
  const circles = [...w.document.querySelectorAll('#fashionPage .fw-cat .fw-cat-circle')];
  assert.equal(circles.length, 2);

  // shop grid: the whole universe (4 products), cardHTML reused
  let cardsInGrid = w.document.querySelectorAll('.fwGrid .pcard');
  assert.equal(cardsInGrid.length, 4);

  // tap Men -> the men's sneaker plus the unisex watch (unisex matches every gender filter)
  cards[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  cardsInGrid = [...w.document.querySelectorAll('.fwGrid .pcard')];
  assert.deepEqual(cardsInGrid.map(el => Number(el.dataset.pid)), [10, 12]);

  // clear the filter, switch to list layout
  cards[0].dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.ok(w.document.querySelector('.fwGrid:not(.list)'));
  const tgl = w.document.querySelectorAll('.fw-layTgl button')[1];
  tgl.dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.ok(w.document.querySelector('.fwGrid.list'));

  // category chip narrows the grid too
  const chips = [...w.document.querySelectorAll('.fw-chip')];
  const shoesChip = chips.find(c => c.textContent === 'Shoes');
  shoesChip.dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(w.document.querySelectorAll('.fwGrid .pcard').length, 3);  // sneakers + gown + waist beads (watch is 'watches')

  page.close();
  assert.ok(!page.isOpen());
});

test('empty world state and the all-categories page degrade gracefully', () => {
  const w = setup();
  load(w, 'components/promotion-slide.js');
  load(w, 'components/drag-gesture.js');
  load(w, 'components/promotional-carousel.js');
  load(w, 'components/fashion-world.js');
  w.document.body.innerHTML = '<div id="fashionPage"></div><div id="fashionCatsPage"></div>';
  const page = new w.Pcx.FashionWorld(w.document.getElementById('fashionPage'), {
    genders: () => [], ads: () => [], sections: () => [], tree: () => null, products: () => [],
    vendorsMap: () => ({}), storeName: () => 'Maccato', cardHTML: () => '',
    onBack() {}, openCart() {}, openSearch() {}, openCategory() {}, openAllCategories() {}, openStore() {}, toast() {}
  });
  page.open();
  assert.ok(w.document.querySelector('#fashionPage .fw-empty'));   // "being curated" state, no fake products
  page.close();

  const cp = new w.Pcx.FashionCatsPage(w.document.getElementById('fashionCatsPage'), {
    tree: () => null, openCategory() {}, onBack() {}
  });
  cp.open();
  assert.ok(w.document.querySelector('#fashionCatsPage .fw-empty'));
  cp.close();
});
