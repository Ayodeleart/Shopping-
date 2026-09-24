const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeSb } = require('./fakesb');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const J = x => JSON.parse(JSON.stringify(x));     // arrays made inside the jsdom window are from another realm
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 8; i++) await tick(); }

/* the storefront modules, loaded the way index.html loads them (plain scripts on one window) */
const windows = [];
test.after(() => windows.forEach(w => w.close()));      // stops the hero's auto-advance timer so the test process can exit
function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="exploreRow"></div><div id="worldPage"></div><div id="catPage"></div></body>',
    { url: 'https://shop.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  windows.push(w);
  w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
  w.Element.prototype.scrollTo = function () {};
  ['data/safe.js', 'data/categories.js', 'data/worlds.js', 'components/explore-marcato.js', 'components/world-sections.js',
    'components/category-page.js', 'components/world-page.js', 'components/food-world.js'].forEach(f => w.eval(read(f)));
  return w;
}

const CATS = [
  { id: 1, parent_id: null, slug: 'food', name: 'Food', sort_order: 1, is_active: true },
  { id: 2, parent_id: 1, slug: 'rice-dishes', name: 'Rice dishes', sort_order: 1, is_active: true },
  { id: 3, parent_id: 1, slug: 'swallow', name: 'Swallow', sort_order: 2, is_active: true },
  { id: 10, parent_id: null, slug: 'fashion-clothing', name: 'Fashion', sort_order: 2, is_active: true },
  { id: 11, parent_id: 10, slug: 'tops', name: 'Tops', sort_order: 1, is_active: true },
  { id: 12, parent_id: 10, slug: 'gowns', name: 'Gowns', sort_order: 2, is_active: true },
  { id: 20, parent_id: null, slug: 'makeup', name: 'Makeup', sort_order: 3, is_active: true },
  { id: 30, parent_id: null, slug: 'hidden-cat', name: 'Hidden', sort_order: 4, is_active: false }
];
const PRODUCTS = [
  { id: 1, name: 'Jollof Rice', category_id: 2, vendor_id: 'v1', created_at: '2026-09-01' },
  { id: 2, name: 'Fried Rice', category_id: 2, vendor_id: 'v1', created_at: '2026-09-02' },
  { id: 3, name: 'Eba and Egusi', category_id: 3, vendor_id: 'v2', created_at: '2026-09-03' },
  { id: 4, name: 'Ankara Top', category_id: 11, created_at: '2026-09-04' },
  { id: 5, name: 'Owambe Gown', category_id: 12, created_at: '2026-09-05' },
  { id: 6, name: 'Lipstick', category_id: 20, created_at: '2026-09-06' },
  { id: 7, name: 'Secret Item', category_id: 30, created_at: '2026-09-07' }
];
const VENDORS = { v1: { id: 'v1', business_name: 'Mama Put', store_slug: 'mama-put' }, v2: { id: 'v2', business_name: 'Buka Hut', store_slug: 'buka-hut' } };

function seed() {
  return {
    worlds: [
      { slug: 'food', title: 'Food', description: 'Restaurants, meals & treats', image_url: 'https://cdn.test/f.jpg', card_gif_url: null, is_active: true, sort_order: 1 },
      { slug: 'fashion', title: 'Fashion', description: 'Style', image_url: null, card_gif_url: null, is_active: true, sort_order: 2 },
      { slug: 'beauty', title: 'Beauty', description: 'Hair & makeup', image_url: null, card_gif_url: null, is_active: true, sort_order: 3 },
      { slug: 'home', title: 'Home & Decor', description: 'Home', image_url: null, card_gif_url: null, is_active: false, sort_order: 4 }
    ],
    world_heroes: [
      { id: 1, world_slug: 'food', title: 'Hungry?', subtitle: 'Order now', image_url: 'https://cdn.test/h1.jpg', gif_url: 'https://cdn.test/h1.gif', cta_type: 'category', cta_label: 'Shop rice', cta_value: 'rice-dishes', is_active: true, sort_order: 1 },
      { id: 2, world_slug: 'food', title: null, subtitle: null, image_url: 'https://cdn.test/h2.jpg', gif_url: null, cta_type: 'none', cta_label: null, cta_value: null, is_active: true, sort_order: 2 },
      { id: 3, world_slug: 'food', title: 'Old slide', subtitle: null, image_url: 'https://cdn.test/h3.jpg', gif_url: null, cta_type: 'none', cta_label: null, cta_value: null, is_active: false, sort_order: 3 }
    ],
    world_display_categories: [
      { id: 1, world_slug: 'food', name: 'Rice', image_url: 'https://cdn.test/rice.png', gif_url: 'https://cdn.test/rice.gif', is_active: true, sort_order: 1 },
      { id: 2, world_slug: 'food', name: 'Swallow', image_url: null, gif_url: null, is_active: true, sort_order: 2 },
      { id: 3, world_slug: 'food', name: 'Soups', image_url: null, gif_url: null, is_active: true, sort_order: 3 },
      { id: 4, world_slug: 'food', name: 'Drinks', image_url: null, gif_url: null, is_active: false, sort_order: 4 },
      { id: 5, world_slug: 'fashion', name: 'Tops', image_url: null, gif_url: null, is_active: true, sort_order: 1 },
      { id: 6, world_slug: 'fashion', name: 'Owambe', image_url: null, gif_url: null, is_active: true, sort_order: 2 },
      { id: 7, world_slug: 'beauty', name: 'Makeup', image_url: null, gif_url: null, is_active: true, sort_order: 1 }
    ],
    world_category_links: [
      { display_category_id: 1, category_id: 2 },
      { display_category_id: 2, category_id: 3 },
      { display_category_id: 5, category_id: 11 },
      { display_category_id: 6, category_id: 12 },
      { display_category_id: 6, category_id: 11 },
      { display_category_id: 7, category_id: 20 }
    ]
  };
}

function ctxFor(w, sb, opts) {
  opts = opts || {};
  const tree = opts.noTree ? null : new w.Pcx.Categories.Tree(CATS.filter(c => c.is_active));
  return {
    sb, tree: () => tree, products: () => PRODUCTS.filter(p => !opts.only || opts.only.includes(p.id)), vendors: () => VENDORS,
    cardHTML: p => '<div class="pcard" data-pid="' + p.id + '">' + w.esc(p.name) + '</div>',
    openStore() {}, openCategory: s => { ctxFor.opened = s; }, openWorldCategory: id => { ctxFor.openedWcat = id; }, onBack() {}
  };
}

/* ------------------------------------------------------------------ homepage: Explore Marcato */
test('the homepage asks for enabled worlds only, in display order', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const r = await w.Worlds.fetch(sb);
  assert.equal(r.legacy, false);
  assert.deepEqual(J(r.list.map(x => x.slug)), ['food', 'fashion', 'beauty']);       // "home" is switched off
  assert.equal(r.list[0].name, 'Food'); assert.equal(r.list[0].tagline, 'Restaurants, meals & treats');
});

test('adding, hiding, removing and re-ordering a world in the database changes the homepage; no code involved', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: true });
  const db = sb._db;
  db.tables.worlds.push({ slug: 'electronics', title: 'Electronics', description: 'Gadgets', image_url: null, card_gif_url: null, is_active: true, sort_order: 0 });
  let list = (await w.Worlds.fetch(sb)).list;
  assert.equal(list[0].slug, 'electronics');                                     // order 0 shows first
  assert.ok(list[0].gradient && list[0].icon);                                    // a world nobody hard-coded still gets a card look
  db.tables.worlds.find(x => x.slug === 'fashion').is_active = false;
  db.tables.worlds = db.tables.worlds.filter(x => x.slug !== 'beauty');
  list = (await w.Worlds.fetch(sb)).list;
  assert.deepEqual(J(list.map(x => x.slug)), ['electronics', 'food']);
  w.Pcx.ExploreMarcato.mount(w.document.getElementById('exploreRow'), list, () => {});
  assert.deepEqual([...w.document.querySelectorAll('.xmCard-name')].map(e => e.textContent), ['Electronics', 'Food']);
  db.tables.worlds = [];
  list = (await w.Worlds.fetch(sb)).list;
  assert.equal(list.length, 0);
  w.Pcx.ExploreMarcato.mount(w.document.getElementById('exploreRow'), list, () => {});
  assert.equal(w.document.querySelectorAll('.xmCard').length, 0);                 // nothing enabled: nothing drawn
});

test('card image and card GIF: the GIF layers over the still image; a GIF alone still shows', async () => {
  const w = boot();
  w.Pcx.ExploreMarcato.mount(w.document.getElementById('exploreRow'), [
    { slug: 'a', name: 'A', tagline: 't', image_url: 'https://cdn.test/a.jpg', gif_url: 'https://cdn.test/a.gif', gradient: 'red', icon: '' },
    { slug: 'b', name: 'B', tagline: 't', image_url: '', gif_url: 'https://cdn.test/b.gif', gradient: 'red', icon: '' },
    { slug: 'c', name: 'C', tagline: '', image_url: '', gif_url: '', gradient: 'red', icon: '' }
  ], () => {});
  const cards = [...w.document.querySelectorAll('.xmCard')];
  assert.deepEqual([...cards[0].querySelectorAll('img')].map(i => i.getAttribute('src')), ['https://cdn.test/a.jpg', 'https://cdn.test/a.gif']);
  assert.ok(cards[0].querySelector('img.xmCard-gif'));
  assert.deepEqual([...cards[1].querySelectorAll('img')].map(i => i.getAttribute('src')), ['https://cdn.test/b.gif']);   // animates: it is the only picture
  assert.equal(cards[2].querySelectorAll('img').length, 0);
});

test('before the migration is run the homepage still works (original five worlds + old card image)', async () => {
  const w = boot();
  const sb = makeSb({ worlds: [{ slug: 'food', image_url: 'https://cdn.test/old.jpg' }] }, { missingColumns: { worlds: ['is_active'] } });
  const r = await w.Worlds.fetch(sb);
  assert.equal(r.legacy, true);
  assert.deepEqual(J(r.list.map(x => x.slug)), ['food', 'fashion', 'beauty', 'home', 'gifts']);
  assert.equal(r.list[0].image_url, 'https://cdn.test/old.jpg');
});

/* ------------------------------------------------------------------ world configuration */
test('a world loads its own enabled hero slides and display categories in order, with their linked categories', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const cfg = await w.Pcx.WorldSections.load(sb, 'food');
  assert.equal(cfg.error, '');
  assert.deepEqual(J(cfg.heroes.map(h => h.id)), [1, 2]);                            // the disabled slide is not returned
  assert.deepEqual(J(cfg.cats.map(c => c.name)), ['Rice', 'Swallow', 'Soups']);       // the disabled "Drinks" is not returned
  assert.deepEqual(J(cfg.cats.map(c => c.categoryIds)), [[2], [3], []]);
  const fashion = await w.Pcx.WorldSections.load(sb, 'fashion');
  assert.deepEqual(J(fashion.cats.map(c => c.name)), ['Tops', 'Owambe']);             // Fashion has its own, not Food's
});

/* ------------------------------------------------------------------ the Food screen (the reported bug) */
test('REGRESSION: Food no longer says "categories haven\'t been set up" when the world is configured', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  // The old code read window.catTree / window.allProds / window.vendorsMap. Those are top-level `let`s in index.html and
  // are NOT window properties, so it always found nothing. Prove the page works with none of them on window.
  assert.equal(w.catTree, undefined); assert.equal(w.allProds, undefined); assert.equal(w.vendorsMap, undefined);
  const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, storeName: () => 'Marcato', ctx: ctxFor(w, sb) });
  page.open(w.Worlds.bySlug('food') || (await w.Worlds.fetch(sb)).list[0]);
  await settle();
  const root = w.document.getElementById('worldPage');
  assert.doesNotMatch(root.textContent, /haven.t been set up/);
  assert.doesNotMatch(root.textContent, /Create a category with the slug/);
});

test('Food screen order: search, hero, display categories (5-per-row grid), then food content', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, ctx: ctxFor(w, sb) });
  page.open({ slug: 'food', name: 'Food', gradient: 'red' });
  await settle();
  const root = w.document.getElementById('worldPage');
  const order = ['.fw-search', '.ws-hero', '.ws-cats', '.fw-vrow'].map(s => root.querySelector(s));
  order.forEach((el, i) => assert.ok(el, 'missing ' + ['search', 'hero', 'display categories', 'restaurants'][i]));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1].compareDocumentPosition(order[i]) & w.Node.DOCUMENT_POSITION_FOLLOWING, 'wrong order at ' + i);
  assert.deepEqual([...root.querySelectorAll('.ws-cat-name')].map(e => e.textContent), ['Rice', 'Swallow', 'Soups']);
  assert.match(read('components/world-sections.css'), /\.ws-cats\{[^}]*grid-template-columns:repeat\(5,/);   // 5 per row on mobile
  assert.equal(root.querySelectorAll('.ws-slide').length, 2);
});

test('Food works from the world configuration alone: no normal category slugged "food" is required', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const noFood = CATS.filter(c => c.slug !== 'food' && c.parent_id !== 1).concat([
    { id: 2, parent_id: null, slug: 'rice-dishes', name: 'Rice dishes', sort_order: 1, is_active: true },
    { id: 3, parent_id: null, slug: 'swallow', name: 'Swallow', sort_order: 2, is_active: true }]);
  const tree = new w.Pcx.Categories.Tree(noFood.filter(c => c.is_active));
  assert.equal(tree.bySlug.food, undefined);
  const ctx = Object.assign(ctxFor(w, sb), { tree: () => tree });
  const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, ctx });
  page.open({ slug: 'food', name: 'Food', gradient: 'red' });
  await settle();
  const root = w.document.getElementById('worldPage');
  assert.equal(root.querySelectorAll('.ws-cat').length, 3);
  assert.ok(root.querySelector('.fw-vrow'), 'restaurants from the linked categories');
  assert.doesNotMatch(root.textContent, /haven.t been set up/);
});

test('a configured Food world with no food listed yet still shows its hero and categories, and says so honestly', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, ctx: ctxFor(w, sb, { only: [4] }) });
  page.open({ slug: 'food', name: 'Food', gradient: 'red' });
  await settle();
  const root = w.document.getElementById('worldPage');
  assert.ok(root.querySelector('.ws-hero')); assert.equal(root.querySelectorAll('.ws-cat').length, 3);
  assert.match(root.textContent, /No food products yet/);
});

/* ------------------------------------------------------------------ same architecture for Fashion, Beauty and a new world */
test('Fashion and Beauty use the exact same world architecture (hero + display categories + only their products)', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const ctx = ctxFor(w, sb);
  const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, ctx });
  page.open({ slug: 'fashion', name: 'Fashion', gradient: 'red' });
  await settle();
  let root = w.document.getElementById('worldPage');
  assert.deepEqual([...root.querySelectorAll('.ws-cat-name')].map(e => e.textContent), ['Tops', 'Owambe']);
  assert.deepEqual([...root.querySelectorAll('.ws-grid3 .pcard')].map(e => e.textContent).sort(), ['Ankara Top', 'Owambe Gown']);   // no food, no makeup
  page.close();
  page.open({ slug: 'beauty', name: 'Beauty', gradient: 'red' });
  await settle();
  root = w.document.getElementById('worldPage');
  assert.deepEqual([...root.querySelectorAll('.ws-cat-name')].map(e => e.textContent), ['Makeup']);
  assert.deepEqual([...root.querySelectorAll('.ws-grid3 .pcard')].map(e => e.textContent), ['Lipstick']);
});

test('a world added later works with no code change; a world with nothing configured says "coming soon"', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: true });
  sb._db.tables.worlds.push({ slug: 'gadgets', title: 'Gadgets', description: '', image_url: null, card_gif_url: null, is_active: true, sort_order: 9 });
  const ctx = ctxFor(w, sb);
  const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, ctx });
  const world = (await w.Worlds.fetch(sb)).list.find(x => x.slug === 'gadgets');
  page.open(world); await settle();
  assert.match(w.document.getElementById('worldPage').textContent, /Coming soon/);
  page.close();
  sb._db.tables.world_display_categories.push({ id: 50, world_slug: 'gadgets', name: 'Phones', image_url: null, gif_url: null, is_active: true, sort_order: 1 });
  sb._db.tables.world_category_links.push({ display_category_id: 50, category_id: 20 });
  w.Pcx.WorldSections.clearCache();
  page.open(world); await settle();
  const root = w.document.getElementById('worldPage');
  assert.deepEqual([...root.querySelectorAll('.ws-cat-name')].map(e => e.textContent), ['Phones']);
  assert.doesNotMatch(root.textContent, /Coming soon/);
});

/* ------------------------------------------------------------------ hero */
test('hero slides: GIF layered over the image, text and button only when set, a dead category button is not drawn', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const cfg = await w.Pcx.WorldSections.load(sb, 'food');
  const host = w.document.createElement('div');
  const ctx = ctxFor(w, sb);
  w.Pcx.WorldSections.renderHero(host, cfg.heroes, ctx);
  const slides = [...host.querySelectorAll('.ws-slide')];
  assert.equal(slides.length, 2);
  assert.deepEqual([...slides[0].querySelectorAll('img')].map(i => i.getAttribute('src')), ['https://cdn.test/h1.jpg', 'https://cdn.test/h1.gif']);
  assert.equal(slides[0].querySelector('.ws-slide-ttl').textContent, 'Hungry?');
  slides[0].querySelector('.ws-slide-cta').click();
  assert.equal(ctxFor.opened, 'rice-dishes');
  assert.equal(slides[1].querySelector('.ws-slide-txt'), null);                    // no title / button: media only
  assert.equal(host.querySelectorAll('.ws-dots span').length, 2);
  const dead = host.ownerDocument.createElement('div');
  w.Pcx.WorldSections.renderHero(dead, [{ image_url: 'x.jpg', cta_type: 'category', cta_label: 'Go', cta_value: 'gone', title: 'T' }], ctx);
  assert.equal(dead.querySelector('.ws-slide-cta'), null);
  const js = host.ownerDocument.createElement('div');
  w.Pcx.WorldSections.renderHero(js, [{ image_url: 'x.jpg', cta_type: 'link', cta_label: 'Go', cta_value: 'javascript:alert(1)' }], ctx);
  assert.equal(js.querySelector('.ws-slide-cta'), null);                           // never an unsafe link
});

/* ------------------------------------------------------------------ display category -> only its products */
test('a display category opens ONLY the products of the categories it is linked to (subcategories included, hidden ones never)', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const ctx = ctxFor(w, sb), WS = w.Pcx.WorldSections;
  const info = await WS.loadCategory(sb, 1);
  assert.equal(info.cat.name, 'Rice'); assert.equal(info.worldName, 'Food');
  assert.deepEqual(J(WS.productsForCategories(ctx, info.categoryIds).map(p => p.name)), ['Jollof Rice', 'Fried Rice']);
  const owambe = await WS.loadCategory(sb, 6);
  assert.deepEqual(J(WS.productsForCategories(ctx, owambe.categoryIds).map(p => p.name).sort()), ['Ankara Top', 'Owambe Gown']);
  assert.deepEqual(J(WS.productsForCategories(ctx, [10]).map(p => p.name).sort()), ['Ankara Top', 'Owambe Gown']);   // parent includes children
  assert.deepEqual(J(WS.productsForCategories(ctx, [30])), []);                        // a hidden marketplace category never leaks its products
  assert.deepEqual(J(WS.productsForCategories(ctx, [])), []);                          // an unlinked display category shows nothing
  assert.equal(await WS.loadCategory(sb, 4), null);                                 // switched off
  assert.equal(await WS.loadCategory(sb, 999), null);
});

test('a display category of a disabled or removed world cannot be opened', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: true });
  sb._db.tables.world_display_categories.push({ id: 60, world_slug: 'home', name: 'Sofas', is_active: true, sort_order: 1 });
  assert.equal(await w.Pcx.WorldSections.loadCategory(sb, 60), null);               // "home" is switched off
});

test('clicking a display category calls the results route; the results page shows just that list', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const ctx = ctxFor(w, sb);
  const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, ctx });
  page.open({ slug: 'food', name: 'Food', gradient: 'red' }); await settle();
  w.document.querySelector('[data-wcat="1"]').click();
  assert.equal(ctxFor.openedWcat, 1);

  const cp = new w.Pcx.CategoryPage(w.document.getElementById('catPage'), { tree: () => null, products: () => PRODUCTS, cardHTML: ctx.cardHTML, go() {}, onBack() {} });
  const info = await w.Pcx.WorldSections.loadCategory(sb, 1);
  cp.openList({ title: info.cat.name, crumb: info.worldName, products: w.Pcx.WorldSections.productsForCategories(ctx, info.categoryIds) });
  const el = w.document.getElementById('catPage');
  assert.equal(el.querySelector('.cpg-title').textContent, 'Rice');
  assert.deepEqual([...el.querySelectorAll('.pcard')].map(e => e.textContent), ['Jollof Rice', 'Fried Rice']);
  assert.match(el.querySelector('.cpg-count').textContent, /^2 items/);
  cp.openList({ title: 'Soups', products: [], emptyTitle: 'Nothing connected yet' });
  assert.match(el.textContent, /Nothing connected yet/);
  assert.equal(el.querySelectorAll('.pcard').length, 0);                            // never falls back to unrelated products
});

/* ------------------------------------------------------------------ security (client side; the real rules are RLS in the SQL) */
test('a visitor (not the admin) cannot change worlds; hidden worlds and slides are not readable', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const ins = await sb.from('worlds').insert({ slug: 'evil', title: 'Evil' }).select().single();
  assert.match(ins.error.message, /row-level security/);
  const upd = await sb.from('worlds').update({ title: 'x' }).eq('slug', 'food').select().single();
  assert.match(upd.error.message, /row-level security/);
  const del = await sb.from('world_display_categories').delete().eq('id', 1);
  assert.match(del.error.message, /row-level security/);
  assert.equal(sb._db.tables.worlds.length, 4);
  const cfg = await w.Pcx.WorldSections.load(sb, 'food');
  assert.ok(cfg.heroes.every(h => h.is_active) && cfg.cats.every(c => c.name !== 'Drinks'));
});

test('a missing table degrades quietly: no crash, and Food falls back to no-config content', async () => {
  const w = boot(), sb = makeSb(seed(), { missingTables: ['world_heroes'] });
  const cfg = await w.Pcx.WorldSections.load(sb, 'food');
  assert.equal(cfg.missing, true);
  const page = new w.Pcx.WorldPage(w.document.getElementById('worldPage'), { onBack() {}, ctx: ctxFor(w, sb) });
  page.open({ slug: 'fashion', name: 'Fashion', gradient: 'red' }); await settle();
  assert.match(w.document.getElementById('worldPage').textContent, /Coming soon/);
});

test('Food: a normal category slugged "food" still feeds the world, and a product reachable twice is listed once', async () => {
  const w = boot(), sb = makeSb(seed(), { isAdmin: false });
  const tree = new w.Pcx.Categories.Tree(CATS.filter(c => c.is_active));
  assert.ok(tree.bySlug.food);                                                   // the old-style Food category exists
  const ctx = ctxFor(w, sb);
  const cfg = await w.Pcx.WorldSections.load(sb, 'food');                        // ... AND display categories link inside it
  const list = w.Pcx.WorldSections.worldProducts(ctx, { slug: 'food' }, cfg);
  const ids = list.map(p => p.id).sort();
  assert.deepEqual(J(ids), [1, 2, 3]);                                           // Jollof, Fried Rice, Eba: each once
  assert.equal(new Set(ids).size, ids.length);
  const alone = w.Pcx.WorldSections.worldProducts(ctx, { slug: 'food' }, { cats: [] });
  assert.deepEqual(J(alone.map(p => p.id).sort()), [1, 2, 3]);                   // the legacy category alone still works
});
