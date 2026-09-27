/* Integration smoke: boot the REAL index.html in jsdom and verify that the sticky home top-nav (#catNav,
   "Home | <category> | <category> | ...", shown once the shopper scrolls past the hero) behaves exactly
   like Konga's — and like the existing "Home" tab already did — for EVERY tab, not just "Home":
     - tapping a real category tab filters Discover More in place on the SAME home screen
     - it never opens the full category-browsing page (#catPage), so there is nothing to "press Back" from
     - the tapped tab is marked active, and every other tab (including "Home") stays one tap away
   This guards against the regression where goNavItem() opened openCategory(it.slug) for any tab that had
   a real category slug, only staying in place for tabs without one. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const catRows = [
  { id: 1, parent_id: null, slug: 'phones-tablets', name: 'Phones & Tablets', is_active: true, sort_order: 1, image_url: null, gif_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 2, parent_id: null, slug: 'electronics', name: 'Electronics & Technology', is_active: true, sort_order: 2, image_url: null, gif_url: null, placeholder_path: null, icon: null, color: null, description: null }
];

const prods = [
  { id: 1, name: 'Phone One', price: 5000, original_price: null, category: 'Phones & Tablets', category_id: 1,
    brand: null, brand_id: null, stock: 5, max_stock: 20, image_url: 'https://x/1.jpg', images: [], vendor_id: null,
    created_at: '2026-09-01T10:00:00Z', featured: false, flash_sale: false },
  { id: 2, name: 'TV One', price: 9000, original_price: null, category: 'Electronics & Technology', category_id: 2,
    brand: null, brand_id: null, stock: 5, max_stock: 20, image_url: 'https://x/2.jpg', images: [], vendor_id: null,
    created_at: '2026-09-01T10:00:00Z', featured: false, flash_sale: false }
];

const tables = {
  products: prods, categories: catRows, banners: [], shortcuts: [],
  store_settings: [{ key: 'storeName', value: 'Marcato Test' }, { key: 'currency', value: 'N' }, { key: 'deliveryInfo', value: '1-2 days' }],
  vendors: [], ads: [], tiles: [], brands: [], product_ratings: [], reviews: [], worlds: [],
  beauty_heroes: [], beauty_categories: [], beauty_settings: [], order_items: [], favorites: []
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

test('sticky home top-nav filters the home feed in place; never opens the full category page', async () => {
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
      w.scrollTo = function () {};
      w.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
    }
  });
  const w = dom.window;
  try {
    await new Promise(res => setTimeout(res, 1500));
    const $ = s => w.document.querySelector(s);
    const $$ = s => [...w.document.querySelectorAll(s)];

    const tabs = () => $$('#catNavRow .cnTab');
    assert.ok(tabs().length >= 3, 'Home + both real categories are tabs (got ' + tabs().length + ')');
    const homeTab = tabs().find(t => t.textContent === 'Home');
    const phonesTab = tabs().find(t => t.textContent === 'Phones & Tablets');
    assert.ok(homeTab && phonesTab, 'both the Home tab and a real category tab are present');
    assert.ok(homeTab.classList.contains('on'), 'Home starts active');

    const hashBefore = w.location.hash;
    const catPageBefore = $('#catPage').classList.contains('open');
    assert.equal(catPageBefore, false, 'the full category page is not open at the start');

    phonesTab.click();
    await new Promise(res => setTimeout(res, 200));

    // the critical regression check: tapping a real-category tab must NOT navigate to #catPage
    assert.equal($('#catPage').classList.contains('open'), false, 'tapping a category tab must not open the full category-browsing page');
    assert.equal(w.location.hash, hashBefore, 'tapping a category tab must not change the URL / navigate away at all');

    // it must instead swap the feed for that category's content on the SAME home screen, in place
    assert.equal($('#allSecTitle').textContent, 'Phones & Tablets', 'the feed retitles to the selected category, in place');
    assert.ok(!$('#allSecHd').hasAttribute('hidden'), 'the category heading is shown once a category is selected');
    assert.ok(w.document.body.classList.contains('cat-mode'), 'the browsing surface switches to category mode in place');
    const cardNames = () => $$('#allGrid .pcard .pcName').map(e => e.textContent);
    assert.deepEqual(cardNames(), ['Phone One'], 'the home feed now shows only that category\'s products');

    // the tapped tab is marked active, and every other tab (Home included) is still one tap away
    assert.ok(tabs().find(t => t.textContent === 'Phones & Tablets').classList.contains('on'), 'the tapped category tab is marked active');
    assert.ok(!tabs().find(t => t.textContent === 'Home').classList.contains('on'), 'Home is no longer marked active');
    assert.equal(tabs().length, 3, 'every tab (Home + both categories) is still present and reachable with one tap');

    // switching straight to another category tab works the same way, still without navigating away
    const electronicsTab = tabs().find(t => t.textContent === 'Electronics & Technology');
    electronicsTab.click();
    await new Promise(res => setTimeout(res, 200));
    assert.equal($('#catPage').classList.contains('open'), false, 'switching tabs again still never opens the full category page');
    assert.equal(w.location.hash, hashBefore, 'switching tabs again still never navigates away');
    assert.deepEqual(cardNames(), ['TV One'], 'the home feed now shows the newly selected category\'s products');

    // and tapping Home returns to the unfiltered home feed, in place, exactly the same way
    tabs().find(t => t.textContent === 'Home').click();
    await new Promise(res => setTimeout(res, 200));
    assert.ok($('#allSecHd').hasAttribute('hidden'), 'Home restores the unbroken Discover feed with no category heading');
    assert.ok(!w.document.body.classList.contains('cat-mode'), 'Home leaves category mode');
    assert.ok($('#catSubs').hasAttribute('hidden') && $('#catMerch').hasAttribute('hidden'), 'no category content leaks into Home');
    assert.deepEqual(cardNames().sort(), ['Phone One', 'TV One'], 'both products are shown again once unfiltered');

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally { w.close(); }
});
