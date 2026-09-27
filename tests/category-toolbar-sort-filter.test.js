/* Integration smoke: boot the REAL index.html in jsdom and verify the sticky bottom Sort by / Filter by
   toolbar on the category page:
     - visible on a real category's product listing, hidden on the "All categories" root view
     - Sort by re-orders the exact same product list in place (price low-to-high, high-to-low, newest)
     - Filter by (brand, price range) narrows the same list in place, shows an active-filter indicator,
       and Clear resets it — all without changing location.hash or leaving the category-browsing interface */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const catRows = [
  { id: 1, parent_id: null, slug: 'shoes', name: 'Shoes', is_active: true, sort_order: 1, image_url: null, gif_url: null, placeholder_path: null, icon: null, color: null, description: null }
];

const prods = [
  { id: 1, name: 'Cheap Old Shoe', price: 2000, original_price: null, category: 'Shoes', category_id: 1,
    brand: 'Acme', brand_id: 1, stock: 5, max_stock: 20, image_url: 'https://x/1.jpg', images: [], vendor_id: null,
    created_at: '2026-01-01T10:00:00Z', featured: false, flash_sale: false },
  { id: 2, name: 'Pricey New Shoe', price: 9000, original_price: null, category: 'Shoes', category_id: 1,
    brand: 'Zenith', brand_id: 2, stock: 5, max_stock: 20, image_url: 'https://x/2.jpg', images: [], vendor_id: null,
    created_at: '2026-09-20T10:00:00Z', featured: false, flash_sale: false },
  { id: 3, name: 'Mid Shoe', price: 5000, original_price: null, category: 'Shoes', category_id: 1,
    brand: 'Acme', brand_id: 1, stock: 5, max_stock: 20, image_url: 'https://x/3.jpg', images: [], vendor_id: null,
    created_at: '2026-05-01T10:00:00Z', featured: false, flash_sale: false }
];

const tables = {
  products: prods, categories: catRows, banners: [], shortcuts: [],
  store_settings: [{ key: 'storeName', value: 'Marcato Test' }, { key: 'currency', value: 'N' }, { key: 'deliveryInfo', value: '1-2 days' }],
  vendors: [], ads: [], tiles: [], brands: [{ id: 1, name: 'Acme', logo_url: null }, { id: 2, name: 'Zenith', logo_url: null }],
  product_ratings: [], reviews: [], worlds: [], beauty_heroes: [], beauty_categories: [], beauty_settings: [], order_items: [], favorites: []
};

function makeClient() {
  function builder(table) {
    let rows = (tables[table] || []).slice();
    const st = {};
    const q = {
      select() { return q; }, eq(c, v) { rows = rows.filter(r => r[c] === v); return q; }, neq(c, v) { rows = rows.filter(r => r[c] !== v); return q; },
      in(c, vs) { rows = rows.filter(r => (Array.isArray(vs) ? vs : []).includes(r[c])); return q; }, or() { return q; },
      ilike(c, v) { rows = rows.filter(r => String(r[c] == null ? '' : r[c]).toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())); return q; },
      order() { return q; }, range() { return q; }, gte(c, v) { rows = rows.filter(r => r[c] >= v); return q; }, lte(c, v) { rows = rows.filter(r => r[c] <= v); return q; },
      limit(n) { rows = rows.slice(0, n); return q; }, single() { st.single = true; return q; }, maybeSingle() { st.maybe = true; return q; },
      insert(arr) { st.ins = arr; return q; }, upsert(arr) { st.ins = arr; st.up = true; return q; }, update(o) { st.upd = o; return q; }, delete() { st.del = true; return q; },
      then(res) {
        if (st.ins) return Promise.resolve({ data: st.ins, error: null }).then(res);
        if (st.upd) rows.forEach(r => Object.assign(r, st.upd));
        if (st.del) tables[table] = tables[table].filter(r => !rows.includes(r));
        return Promise.resolve({ data: (st.single || st.maybe) ? (rows[0] || null) : rows, error: null }).then(res);
      }
    };
    return q;
  }
  return {
    from: t => builder(t), rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signInWithOAuth: async () => ({ data: null, error: { message: 'stub' } }), signOut: async () => ({}) },
    storage: { from: () => ({ list: async () => ({ data: [] }), getPublicUrl: p => ({ data: { publicUrl: 'https://x/' + p } }) }) },
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
  };
}

class LocalOnlyLoader extends ResourceLoader {
  fetch(url) {
    if (url.startsWith('https://shop.test/')) {
      const p = path.join(ROOT, new URL(url).pathname);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
      return Promise.reject(new Error('not found ' + p));
    }
    return Promise.reject(new Error('no network in smoke test: ' + url));
  }
}

test('category page: sticky Sort by / Filter by toolbar', async () => {
  const htmlPath = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8').replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String((e && e.message) || e); if (!/no network|not found \/home|Could not load|Could not parse CSS/i.test(m)) errors.push(m.split('\n')[0]); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 400)));
  const dom = new JSDOM(html, {
    url: 'https://shop.test/index.html', runScripts: 'dangerously', resources: new LocalOnlyLoader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.supabase = { createClient: () => makeClient() };
      w.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
    }
  });
  const w = dom.window;
  try {
    await new Promise(res => setTimeout(res, 1500));
    const $ = s => w.document.querySelector(s);
    const $$ = s => [...w.document.querySelectorAll(s)];
    const cardIds = () => $$('.cpg-grid .pcard').map(c => Number((c.getAttribute('onclick') || '').match(/\d+/)[0]));

    // hidden on the "All categories" root view
    w.location.hash = '#cat=all';
    await new Promise(res => setTimeout(res, 60));
    assert.equal($('.cpg-toolbar').style.display, 'none', 'toolbar hidden when there is no single product listing');

    // visible on a real category
    w.location.hash = '#cat=shoes';
    await new Promise(res => setTimeout(res, 60));
    assert.notEqual($('.cpg-toolbar').style.display, 'none', 'toolbar visible on a real category page');
    assert.deepEqual(cardIds(), [1, 2, 3], 'default order is the category\'s natural product order');

    // Sort by: price low to high
    $('[data-tb="sort"]').click();
    await new Promise(res => setTimeout(res, 10));
    assert.ok($('.cpg-sheet').classList.contains('on'), 'sort sheet opens');
    $('[data-sort="price_asc"]').click();
    await new Promise(res => setTimeout(res, 260));
    assert.deepEqual(cardIds(), [1, 3, 2], 'price low-to-high reorders the same list');
    assert.ok(!$('.cpg-sheet').classList.contains('on'), 'sheet closes after choosing a sort');
    assert.equal(w.location.hash, '#cat=shoes', 'sorting does not navigate away');

    // Sort by: price high to low
    $('[data-tb="sort"]').click();
    await new Promise(res => setTimeout(res, 10));
    $('[data-sort="price_desc"]').click();
    await new Promise(res => setTimeout(res, 260));
    assert.deepEqual(cardIds(), [2, 3, 1], 'price high-to-low reorders the same list');

    // Sort by: newest
    $('[data-tb="sort"]').click();
    await new Promise(res => setTimeout(res, 10));
    $('[data-sort="newest"]').click();
    await new Promise(res => setTimeout(res, 260));
    assert.deepEqual(cardIds(), [2, 3, 1], 'newest-first matches created_at order');

    // Filter by: brand
    $('[data-tb="filter"]').click();
    await new Promise(res => setTimeout(res, 10));
    assert.ok($('.cpg-sheet').classList.contains('on'), 'filter sheet opens');
    const brandSel = $('[data-flt="brand"]');
    assert.ok(brandSel, 'brand filter is offered (brands exist among these products)');
    brandSel.value = 'Acme';
    brandSel.dispatchEvent(new w.Event('change'));
    $('[data-flt-apply]').click();
    await new Promise(res => setTimeout(res, 260));
    assert.deepEqual(cardIds().sort((a, b) => a - b), [1, 3], 'brand filter narrows to Acme products only');
    assert.equal(w.location.hash, '#cat=shoes', 'filtering does not navigate away');
    assert.notEqual($('.cpg-tbdot').style.display, 'none', 'active-filter indicator shown');

    // Filter by: price range on top of the brand filter
    $('[data-tb="filter"]').click();
    await new Promise(res => setTimeout(res, 10));
    $('[data-flt="minPrice"]').value = '3000';
    $('[data-flt-apply]').click();
    await new Promise(res => setTimeout(res, 260));
    assert.deepEqual(cardIds(), [3], 'price range further narrows the brand-filtered list');

    // Clear filters
    $('[data-tb="filter"]').click();
    await new Promise(res => setTimeout(res, 10));
    $('[data-flt-clear]').click();
    await new Promise(res => setTimeout(res, 260));
    assert.deepEqual(cardIds().sort((a, b) => a - b), [1, 2, 3], 'Clear restores the full list');
    assert.equal($('.cpg-tbdot').style.display, 'none', 'active-filter indicator cleared');

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally { w.close(); }
});
