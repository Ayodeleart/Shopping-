/* Integration smoke: boot the REAL index.html in jsdom and verify:
     - compact merchandising cards (Flash Sales, home category rows, category-page merch rails) have no
       Add to Cart button; standard cards (Discover More, the category page's main grid) always do
     - the category page's sticky top-level bar switches category in place (no reload, no full navigation)
     - category-page merchandising sections (Flash Deals/Popular/Hot Deals/Brand Deals) only show real,
       eligible products and use compact cards
     - admin-configurable ad placement: a section_gap ad (scope:'all') appears between curated sections on
       the category page, a feed ad scoped to one category appears inside that category's product grid, and
       a home-only ad never appears on a category page at all */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const catRows = [
  { id: 1, parent_id: null, slug: 'shoes', name: 'Shoes', is_active: true, sort_order: 1, image_url: null, gif_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 2, parent_id: null, slug: 'clothing', name: 'Clothing', is_active: true, sort_order: 2, image_url: null, gif_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 4, parent_id: 1, slug: 'sneakers', name: 'Sneakers', is_active: true, sort_order: 1, image_url: null, gif_url: null, placeholder_path: null, icon: null, color: null, description: null }
];

const prods = [];
// Sneakers (subcategory of Shoes): a flash deal, a plain discount, a rated product, a branded discount
prods.push({ id: 1, name: 'Flash Sneaker', price: 4000, original_price: 6000, category: 'Shoes', category_id: 4,
  brand: 'Runfast', brand_id: 1, stock: 5, max_stock: 20, image_url: 'https://x/1.jpg', images: [], vendor_id: null,
  created_at: '2026-09-01T10:00:00Z', featured: false, flash_sale: true });
prods.push({ id: 2, name: 'Discount Sneaker', price: 5000, original_price: 7000, category: 'Shoes', category_id: 4,
  brand: 'Runfast', brand_id: 1, stock: 5, max_stock: 20, image_url: 'https://x/2.jpg', images: [], vendor_id: null,
  created_at: '2026-09-01T10:00:00Z', featured: false, flash_sale: false });
prods.push({ id: 3, name: 'Rated Sneaker', price: 9000, original_price: null, category: 'Shoes', category_id: 4,
  brand: 'Runfast', brand_id: 1, stock: 5, max_stock: 20, image_url: 'https://x/3.jpg', images: [], vendor_id: null,
  created_at: '2026-09-01T10:00:00Z', featured: false, flash_sale: false });
prods.push({ id: 4, name: 'Plain Sneaker', price: 3000, original_price: null, category: 'Shoes', category_id: 4,
  brand: null, brand_id: null, stock: 5, max_stock: 20, image_url: 'https://x/4.jpg', images: [], vendor_id: null,
  created_at: '2026-09-01T10:00:00Z', featured: false, flash_sale: false });
prods.push({ id: 5, name: 'No-Brand Discount Sneaker', price: 2000, original_price: 3000, category: 'Shoes', category_id: 4,
  brand: null, brand_id: null, stock: 5, max_stock: 20, image_url: 'https://x/6.jpg', images: [], vendor_id: null,
  created_at: '2026-09-01T10:00:00Z', featured: false, flash_sale: false });
prods.push({ id: 101, name: 'Shirt One', price: 2000, original_price: null, category: 'Clothing', category_id: 2,
  brand: null, brand_id: null, stock: 5, max_stock: 20, image_url: 'https://x/5.jpg', images: [], vendor_id: null,
  created_at: '2026-09-01T10:00:00Z', featured: false, flash_sale: false });

const tables = {
  products: prods,
  categories: catRows,
  banners: [],
  shortcuts: [],
  store_settings: [
    { key: 'storeName', value: 'Marcato Test' }, { key: 'currency', value: 'N' }, { key: 'deliveryInfo', value: '1-2 days' },
    { key: 'flashSaleEnd', value: String(Date.now() + 3 * 60 * 60 * 1000) }
  ],
  vendors: [],
  ads: [
    { id: 701, name: 'Everywhere Gap Ad', brand: 'Global Co', active: true, after_rows: 5, sort_order: 1,
      placement: 'section_gap', scope: 'all', category_id: null,
      accent: '#111', logo_url: '', feed_image: 'https://x/ad1.jpg', feed_title: 'Everywhere Ad', feed_sub: '', feed_cta: 'Shop', page: {} },
    { id: 702, name: 'Shoes Feed Ad', brand: 'Shoe Co', active: true, after_rows: 1, sort_order: 1,
      placement: 'feed', scope: 'category', category_id: 1,
      accent: '#222', logo_url: '', feed_image: 'https://x/ad2.jpg', feed_title: 'Shoes Feed Ad', feed_sub: '', feed_cta: 'Shop', page: {} },
    { id: 703, name: 'Home Only Ad', brand: 'Home Co', active: true, after_rows: 5, sort_order: 2,
      placement: 'section_gap', scope: 'home', category_id: null,
      accent: '#333', logo_url: '', feed_image: 'https://x/ad3.jpg', feed_title: 'Home Only Ad', feed_sub: '', feed_cta: 'Shop', page: {} }
  ],
  tiles: [],
  brands: [{ id: 1, name: 'Runfast', logo_url: null }],
  product_ratings: [
    { product_id: 3, avg_rating: 4.5, review_count: 2 }
  ],
  reviews: [],
  worlds: [],
  beauty_heroes: [], beauty_categories: [], beauty_settings: [],
  order_items: [], favorites: []
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
  fetch(url) {
    if (url.startsWith('https://shop.test/')) {
      const p = path.join(ROOT, new URL(url).pathname);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
      return Promise.reject(new Error('not found ' + p));
    }
    return Promise.reject(new Error('no network in smoke test: ' + url));
  }
}

async function bootHome() {
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
  await new Promise(res => setTimeout(res, 1500));
  return { dom, w: dom.window, errors };
}

test('compact merchandising cards have no Add to Cart; standard cards always do', async () => {
  const { dom, w, errors } = await bootHome();
  try {
    const $$ = s => [...w.document.querySelectorAll(s)];
    // Flash Sales rail (home) is compact
    const flashCards = $$('#flashScroll .pcard');
    assert.ok(flashCards.length > 0, 'flash rail has cards');
    flashCards.forEach(c => assert.ok(!c.querySelector('.pcCtl'), 'flash card has no Add to Cart control'));
    // every other curated home rail is compact too (they all use the merchandising variant)
    const railCards = $$('#main .fcard-wrap .pcard');
    assert.ok(railCards.length > 0, 'curated home rails have cards');
    railCards.forEach(c => assert.ok(!c.querySelector('.pcCtl'), 'merchandising rail card has no Add to Cart control'));
    railCards.forEach(c => assert.ok(c.querySelector('.favBtn'), 'merchandising rail card keeps its favourite button'));
    // Discover feed (standard) always has Add to Cart
    const discoverCards = $$('#allGrid .pcard');
    assert.ok(discoverCards.length > 0, 'the Discover feed has cards');
    discoverCards.forEach(c => assert.ok(c.querySelector('.pcCtl'), 'Discover card has an Add to Cart control'));

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally { dom.window.close(); }
});

test('category page: sticky top-level bar switches category in place; subcategory tiles are round; merch sections use compact cards; ad placement respects admin scope', async () => {
  const { dom, w, errors } = await bootHome();
  try {
    const $ = s => w.document.querySelector(s);
    const $$ = s => [...w.document.querySelectorAll(s)];

    w.location.hash = '#cat=shoes';
    await new Promise(res => setTimeout(res, 60));

    // sticky catbar lists every root category, Shoes marked active
    const catbarBtns = $$('.cpg-cbtn');
    assert.ok(catbarBtns.length >= 3, 'catbar lists All + both root categories');
    const activeBtn = catbarBtns.find(b => b.classList.contains('on') && b.textContent === 'Shoes');
    assert.ok(activeBtn, 'Shoes marked active in the sticky bar');

    // subcategory tile (Sneakers) uses the round shape
    const subTile = $$('.cpg-tile').find(t => t.textContent.includes('Sneakers'));
    assert.ok(subTile, 'Sneakers subcategory tile rendered');
    assert.ok(subTile.querySelector('.cat-thumb.round'), 'subcategory tile uses the circular shape variant');

    // merch sections: only real, eligible rails show, with compact cards (no Add to Cart)
    const msecTitles = $$('.cpg-msec-ttl').map(e => e.textContent);
    assert.ok(msecTitles.some(t => t.includes('Flash Deals')), 'Flash Deals rail shown (real flash_sale product)');
    assert.ok(msecTitles.some(t => t.includes('Popular')), 'Popular rail shown (real rating)');
    assert.ok(msecTitles.some(t => t === 'Hot Deals'), 'Hot Deals rail shown (real discount)');
    assert.ok(msecTitles.some(t => t === 'Brand Deals'), 'Brand Deals rail shown (real branded discount)');
    $$('.cpg-msec .pcard').forEach(c => assert.ok(!c.querySelector('.pcCtl'), 'merch section card has no Add to Cart control'));

    // switching category via the sticky bar updates in place — no full reload, same document/page instance
    const beforeSwitchPage = $('#catPage');
    catbarBtns.find(b => b.textContent === 'Clothing').click();
    await new Promise(res => setTimeout(res, 60));
    assert.equal(w.location.hash, '#cat=clothing', 'tapping a root category in the bar navigates to it');
    assert.equal($('#catPage'), beforeSwitchPage, 'same page instance updated in place, not reloaded');
    assert.equal($('.cpg-title').textContent, 'Clothing', 'content switched to the newly selected category');
    assert.ok(catbarBtns.length && $$('.cpg-cbtn').find(b => b.classList.contains('on') && b.textContent === 'Clothing'), 'active indicator follows the switch');

    // ad placement: go back to Shoes to check ad slots
    w.location.hash = '#cat=shoes';
    await new Promise(res => setTimeout(res, 60));
    // scope:'all' section_gap ad shows between curated sections
    const gapAd = $$('.cpg-adgap .adslot');
    assert.ok(gapAd.length > 0, 'a scope:"all" section_gap ad renders on the category page');
    // scope:'category', placement:'feed' ad targeting Shoes shows inside the main grid
    assert.ok($('.cpg-grid .adslot'), 'a feed ad scoped to this category renders inside its product grid');
    // a home-only ad never appears here
    assert.ok(!w.document.getElementById('catPage').innerHTML.includes('Home Only Ad'), 'a scope:"home" ad is never shown on a category page');

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally { dom.window.close(); }
});
