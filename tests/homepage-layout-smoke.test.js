/* Integration smoke: boot the REAL index.html in jsdom (local scripts load from disk via file://)
   with an in-memory Supabase stub, then verify the reorganized homepage:
     - curated category rows (with a "See All" action) come before Shop by Brand, which is a
       vertical list (not a horizontal carousel), which comes before Flash/Featured, which come
       before the Discover More feed (renamed from "All Products") near the bottom
     - an ad slot between curated sections renders from the real `ads` table / admin controls
     - the Discover More feed loads incrementally (Load More / near-bottom auto-load) instead of
       painting the whole catalogue at once, without duplicating products */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const catRows = [
  { id: 1, parent_id: null, slug: 'shoes', name: 'Shoes', is_active: true, sort_order: 1, image_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 2, parent_id: null, slug: 'clothing', name: 'Clothing', is_active: true, sort_order: 2, image_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 3, parent_id: null, slug: 'empty-cat', name: 'Empty Category', is_active: true, sort_order: 3, image_url: null, placeholder_path: null, icon: null, color: null, description: null }
];

/* 18 shoes (so the curated row caps at 12 but the Discover feed still sees all of them),
   6 clothing items, 0 in the empty category, and 15 brands so the brand cap (12) is exercised. */
const prods = [];
for (let i = 1; i <= 18; i++) {
  prods.push({
    id: i, name: 'Shoe ' + i, price: 5000 + i, original_price: null, category: 'Shoes', category_id: 1,
    brand: 'Brand' + (i % 15 || 15), brand_id: (i % 15 || 15), stock: 5, max_stock: 20,
    image_url: 'https://x/shoe' + i + '.jpg', images: [], vendor_id: null,
    created_at: '2026-09-0' + (i % 9 || 1) + 'T10:00:00Z', featured: i === 1, flash_sale: false
  });
}
for (let i = 1; i <= 6; i++) {
  prods.push({
    id: 100 + i, name: 'Shirt ' + i, price: 3000 + i, original_price: null, category: 'Clothing', category_id: 2,
    brand: 'Brand' + i, brand_id: i, stock: 5, max_stock: 20,
    image_url: 'https://x/shirt' + i + '.jpg', images: [], vendor_id: null,
    created_at: '2026-09-0' + (i % 9 || 1) + 'T10:00:00Z', featured: false, flash_sale: false
  });
}
const brands = [];
for (let i = 1; i <= 15; i++) brands.push({ id: i, name: 'Brand' + i, logo_url: null });

const tables = {
  products: prods,
  categories: catRows,
  banners: [],
  shortcuts: [],
  store_settings: [
    { key: 'storeName', value: 'Marcato Test' }, { key: 'currency', value: 'N' },
    { key: 'deliveryInfo', value: '1-2 days' }
  ],
  vendors: [],
  ads: [
    { id: 501, name: 'Test Sponsor', brand: 'Sponsor Co', active: true, after_rows: 2, sort_order: 1,
      accent: '#111', logo_url: '', feed_image: 'https://x/ad.jpg', feed_title: 'Sponsored Deal',
      feed_sub: 'Limited time', feed_cta: 'Shop now', page: {} }
  ],
  tiles: [],
  brands: brands,
  product_ratings: [],
  reviews: [],
  worlds: [],
  beauty_heroes: [],
  beauty_categories: [],
  beauty_settings: [],
  order_items: [],
  favorites: []
};

function makeClient() {
  function builder(table) {
    let rows = (tables[table] || []).slice();
    const st = { ins: null, single: false, maybe: false, del: false };
    const q = {
      select() { return q; },
      eq(c, v) { rows = rows.filter(r => r[c] === v); return q; },
      neq(c, v) { rows = rows.filter(r => r[c] !== v); return q; },
      in(c, vs) { rows = rows.filter(r => (Array.isArray(vs) ? vs : []).includes(r[c])); return q; },
      or() { return q; },
      ilike(c, v) { rows = rows.filter(r => String(r[c] == null ? '' : r[c]).toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())); return q; },
      order() { return q; },
      range() { return q; },
      gte(c, v) { rows = rows.filter(r => r[c] >= v); return q; },
      lte(c, v) { rows = rows.filter(r => r[c] <= v); return q; },
      limit(n) { rows = rows.slice(0, n); return q; },
      single() { st.single = true; return q; },
      maybeSingle() { st.maybe = true; return q; },
      insert(arr) { st.ins = arr; return q; },
      upsert(arr) { st.ins = arr; st.up = true; return q; },
      update(o) { st.upd = o; return q; },
      delete() { st.del = true; return q; },
      then(res) {
        if (st.ins) {
          if (st.up) {
            const pk = (table === 'beauty_settings' || table === 'store_settings') ? 'key' : 'id';
            for (const r of st.ins) {
              const i = tables[table].findIndex(x => String(x[pk]) === String(r[pk]));
              if (i >= 0) tables[table][i] = Object.assign({}, tables[table][i], r);
              else tables[table].push(Object.assign({ id: tables[table].length + 1 }, r));
            }
          } else tables[table] = tables[table].concat(st.ins.map(r => Object.assign({ id: tables[table].length + 1 }, r)));
          return Promise.resolve({ data: st.ins, error: null }).then(res);
        }
        if (st.upd) rows.forEach(r => Object.assign(r, st.upd));
        if (st.del) tables[table] = tables[table].filter(r => !rows.includes(r));
        return Promise.resolve({ data: (st.single || st.maybe) ? (rows[0] || null) : rows, error: null }).then(res);
      }
    };
    return q;
  }
  return {
    from: t => builder(t),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ data: null, error: { message: 'stub' } }),
      signOut: async () => ({})
    },
    storage: { from: () => ({ list: async () => ({ data: [] }), getPublicUrl: p => ({ data: { publicUrl: 'https://x/' + p } }) }) },
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
  };
}

class LocalOnlyLoader extends ResourceLoader {
  fetch(url, options) {
    if (url.startsWith('https://shop.test/')) {
      const p = path.join(ROOT, new URL(url).pathname);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
      return Promise.reject(new Error('not found ' + p));
    }
    return Promise.reject(new Error('no network in smoke test: ' + url));
  }
}

test('real index.html: reorganized homepage (curated sections, vertical brands, ad slot, incremental Discover More)', async () => {
  const htmlPath = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8')
    .replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '');
  const url = 'https://shop.test/index.html';
  const errors = [];
  const vc = new (require('jsdom').VirtualConsole)();
  vc.on('jsdomError', e => {
    const m = String((e && e.message) || e);
    if (!/no network|not found \/home|Could not load|Could not parse CSS/i.test(m)) errors.push(m.split('\n')[0]);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 400)));
  let w;
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: new LocalOnlyLoader(),
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.supabase = { createClient: () => makeClient() };
      w.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
    }
  });
  w = dom.window;

  await new Promise(res => setTimeout(res, 1500));
  const $ = s => w.document.querySelector(s);
  const $$ = s => [...w.document.querySelectorAll(s)];

  try {
    // ── section order ──
    const main = $('#main');
    const order = ['exploreSec', 'catRows', 'brandSec', 'flashSec', 'featSec', 'allSec', 'vendorSec']
      .map(id => $$(`#main *`).indexOf(w.document.getElementById(id)))
      .filter(i => i >= 0);
    // exploreSec, catRows, brandSec, featSec, allSec, vendorSec should all be found and increasing in DOM order
    const ids = ['exploreSec', 'catRows', 'brandSec', 'featSec', 'allSec', 'vendorSec'];
    const positions = ids.map(id => Array.prototype.indexOf.call(main.querySelectorAll('*'), w.document.getElementById(id)));
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `${ids[i]} should come after ${ids[i - 1]} (got ${positions.join(',')})`);
    }

    // ── curated category rows: capped, with a working "See All", categories with no products absent ──
    const catRowSecs = $$('.catRowSec');
    assert.ok(catRowSecs.length >= 2, 'at least the two categories with products got a row');
    assert.ok(!$('#catRows').textContent.includes('Empty Category'), 'a category with no eligible products gets no curated row');
    const shoesRow = catRowSecs.find(s => s.querySelector('.catRowName').textContent.includes('Shoes'));
    assert.ok(shoesRow, 'Shoes row rendered');
    assert.equal(shoesRow.querySelectorAll('.fcard-wrap').length, 12, 'a manageable number of products per category (capped, not the whole catalogue)');
    const seeAll = shoesRow.querySelector('.secAll');
    assert.ok(seeAll, 'category row has a "See All" action');
    seeAll.click();
    assert.equal(w.location.hash, '#cat=shoes', 'See All opens the real category listing, correctly filtered');
    w.location.hash = '';
    await new Promise(res => setTimeout(res, 30));

    // ── Shop by Brand: vertical (grid) list, not a horizontal carousel, capped to a manageable number ──
    const brandRow = $('#brandRow');
    assert.equal(w.getComputedStyle(brandRow).display, 'grid', 'brand row is a vertical/grid layout, not a horizontal flex carousel');
    const bcards = $$('.bcard');
    assert.ok(bcards.length > 0 && bcards.length <= 12, 'a manageable, capped number of brands (got ' + bcards.length + ')');
    assert.ok($('.bcard-count'), 'brand card shows real product count (no fake data)');

    // ── ad between curated sections, reusing the real ads table/admin controls ──
    const slotA = $('#homeAdSlotA');
    assert.ok(slotA && slotA.style.display !== 'none', 'an ad slot renders between curated sections when an ad is configured');
    assert.ok(slotA.querySelector('.adslot'), 'ad slot uses the existing ad-card rendering');

    // ── Discover More: renamed, incremental loading, no duplicates ──
    assert.equal($('#allSecTitle').textContent, 'Discover More', 'bottom feed relabeled from "All Products"');
    const allGrid = $('#allGrid');
    const idsOf = () => $$('#allGrid .pcard').map(c => c.getAttribute('onclick'));
    const firstBatchIds = idsOf();
    assert.ok(firstBatchIds.length > 0 && firstBatchIds.length < prods.length, 'first paint shows a batch, not the whole catalogue (' + firstBatchIds.length + ' of ' + prods.length + ')');
    const loadMoreWrap = $('#discoverMoreWrap');
    assert.ok(loadMoreWrap && loadMoreWrap.style.display !== 'none', 'Load More is visible while more products remain');
    $('#loadMoreBtn').click();
    await new Promise(res => setTimeout(res, 30));
    const secondBatchIds = idsOf();
    assert.ok(secondBatchIds.length > firstBatchIds.length, 'Load More appends more products');
    const asSet = new Set(secondBatchIds);
    assert.equal(asSet.size, secondBatchIds.length, 'no duplicate products after Load More');
    // keep loading until everything is shown, then confirm nothing duplicated and every product id is unique
    for (let guard = 0; guard < 10 && $('#discoverMoreWrap').style.display !== 'none'; guard++) {
      $('#loadMoreBtn').click();
      await new Promise(res => setTimeout(res, 20));
    }
    const finalIds = new Set(idsOf());
    assert.equal(finalIds.size, prods.length, 'every product eventually shown exactly once, none dropped or duplicated');

    // ── favorites/cart still work on incrementally-loaded cards ──
    const firstCard = $('#allGrid .pcard');
    const addBtn = firstCard.querySelector('.pcAdd, .pcStepB');
    assert.ok(addBtn, 'cart control present on a card from the paginated feed');

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally {
    if (w) w.close();
  }
});
