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

const prods0 = [
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

const prods = prods0.map((p, i) => Object.assign({}, p, [
  { attributes: { colors: ['Black', 'Red'], sizes: { system: 'EU', values: ['40', '41'] } } },
  { attributes: { colors: ['Black'] }, stock: 0 },
  { attributes: { colors: ['White'] }, original_price: 7000 }
][i]));

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


test('home surface: category picked in the sticky nav shows the Sort by / Filter by toolbar and it works in place', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '');
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
      w.scrollTo = function () {};
      w.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
    }
  });
  const w = dom.window;
  const wait = ms => new Promise(res => setTimeout(res, ms));
  try {
    await wait(1500);
    const $ = s => w.document.querySelector(s);
    const $$ = s => [...w.document.querySelectorAll(s)];
    const ids = () => $$('#allGrid .pcard').map(c => Number((c.getAttribute('onclick') || '').match(/\d+/)[0]));
    const bar = () => $$('body > .cpg-toolbar')[0];
    const sh = () => $('body > .cpg-sheet');

    // Home feed: no toolbar
    assert.ok(!bar() || bar().style.display === 'none', 'no toolbar on the Home feed');

    // pick the category in the sticky nav
    const tab = $$('#catNavRow .cnTab').find(b => /shoes/i.test(b.textContent));
    assert.ok(tab, 'Shoes is in the sticky category nav');
    tab.click();
    await wait(200);
    assert.ok(bar(), 'toolbar exists on the in-place category view');
    assert.notEqual(bar().style.display, 'none', 'toolbar is visible');
    assert.equal(bar().parentNode, w.document.body, 'toolbar is a direct child of <body> so position:fixed is viewport-relative');
    assert.ok(w.document.body.classList.contains('has-cat-toolbar'), 'body reserves room so the pill never covers the last row');
    assert.deepEqual(ids().sort((a, b) => a - b), [1, 2, 3]);
    const hash0 = w.location.hash;

    // sort
    for (const [key, want] of [['price_asc', [1, 3, 2]], ['price_desc', [2, 3, 1]], ['newest', [2, 3, 1]]]) {
      bar().querySelector('[data-tb="sort"]').click(); await wait(15);
      sh().querySelector(`[data-sort="${key}"]`).click(); await wait(260);
      assert.deepEqual(ids(), want, 'sort ' + key);
    }
    assert.equal(sh().querySelector('[data-sort="popular"]'), null, 'popularity sort is not offered when no product has ratings');

    // filter: sheet offers only data-backed options
    bar().querySelector('[data-tb="filter"]').click(); await wait(15);
    const sheet = sh();
    assert.ok(sheet.classList.contains('on'), 'filter sheet opens');
    assert.deepEqual([...sheet.querySelectorAll('[data-flt="brand"] option')].map(o => o.value).sort(), ['', 'Acme', 'Zenith']);
    assert.deepEqual([...sheet.querySelectorAll('[data-chip="colors"]')].map(o => o.dataset.v).sort(), ['Black', 'Red', 'White'], 'colours come from products\' own attributes');
    assert.deepEqual([...sheet.querySelectorAll('[data-chip="sizes"]')].map(o => o.dataset.v), ['40', '41'], 'sizes come from products\' own attributes');
    assert.ok(sheet.querySelector('[data-flt="inStock"]'), 'in-stock toggle offered because one product is out of stock');
    assert.ok(sheet.querySelector('[data-flt="onSale"]'), 'on-sale toggle offered because one product is discounted');

    // colour chip + apply
    sheet.querySelector('[data-chip="colors"][data-v="Black"]').click();
    sheet.querySelector('[data-flt-apply]').click(); await wait(260);
    assert.deepEqual(ids().sort((a, b) => a - b), [1, 2], 'colour filter');
    assert.match($('#pCount').textContent, /2 items \(of 3\)/);
    assert.notEqual(bar().querySelector('.cpg-tbdot').style.display, 'none', 'active-filter dot');

    // in-stock on top
    bar().querySelector('[data-tb="filter"]').click(); await wait(15);
    sh().querySelector('[data-flt="inStock"]').checked = true;
    sh().querySelector('[data-flt-apply]').click(); await wait(260);
    assert.deepEqual(ids(), [1], 'in-stock only drops the out-of-stock product');

    // impossible combo -> honest empty state, toolbar stays
    bar().querySelector('[data-tb="filter"]').click(); await wait(15);
    sh().querySelector('[data-flt="minPrice"]').value = '99999';
    sh().querySelector('[data-flt-apply]').click(); await wait(260);
    assert.deepEqual(ids(), []);
    assert.match($('#allGrid').textContent, /No products match those filters/);
    assert.notEqual(bar().style.display, 'none');

    // clear
    bar().querySelector('[data-tb="filter"]').click(); await wait(15);
    sh().querySelector('[data-flt-clear]').click(); await wait(260);
    assert.deepEqual(ids().sort((a, b) => a - b), [1, 2, 3], 'Clear restores the whole category');
    assert.equal(bar().querySelector('.cpg-tbdot').style.display, 'none');

    // nothing navigated; sticky nav still there and still marks Shoes as the active tab
    assert.equal(w.location.hash, hash0, 'sorting/filtering never navigates');
    assert.ok($('#catNav'), 'sticky category nav still present');
    assert.ok($$('#catNavRow .cnTab.on').some(b => /shoes/i.test(b.textContent)), 'selected category is preserved');
    assert.ok(w.document.body.classList.contains('cat-mode'));

    // a filter set for Shoes must not leak: back to Home hides the pill, re-entering starts clean
    $$('#catNavRow .cnTab')[0].click(); await wait(200);
    assert.equal(bar().style.display, 'none', 'toolbar hidden again on Home');
    assert.ok(!w.document.body.classList.contains('has-cat-toolbar'));

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally { w.close(); }
});
