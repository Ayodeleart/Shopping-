/* Integration: boot the REAL index.html in jsdom against a Supabase stub that behaves like PostgREST
   (a plain select is capped at 1000 rows unless the caller pages with .range()), and verify the
   browsing surface the shopper actually sees:

     1. the false "No products yet" — a catalogue larger than one PostgREST page must still resolve
        every category. This is the actual root cause: init() used to run `select('*')` with no
        .range(), so only the newest 1000 products ever reached the client and every category whose
        products fell outside that window rendered an empty state.
     2. a category selected from the sticky bar renders, IN ORDER: circular subcategory tiles ->
        eligible merchandising rails -> the standard product grid, and nothing from the previous
        category or from Home leaks into it.
     3. a category with no products shows a loading state first and the empty state only after the
        query has actually completed.
     4. Home has no category catalogue rows, no in-feed subcategory tiles and no second category nav. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PAGE_CAP = 1000;                      /* what PostgREST's db-max-rows does to an un-ranged select */

const catRows = [
  { id: 1, parent_id: null, slug: 'phones-tablets', name: 'Phones & Tablets', is_active: true, sort_order: 1, image_url: 'https://x/c1.jpg', gif_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 2, parent_id: null, slug: 'electronics', name: 'Electronics', is_active: true, sort_order: 2, image_url: 'https://x/c2.jpg', gif_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 3, parent_id: null, slug: 'garden', name: 'Garden', is_active: true, sort_order: 3, image_url: null, gif_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 11, parent_id: 1, slug: 'smartphones', name: 'Smartphones', is_active: true, sort_order: 1, image_url: 'https://x/c11.jpg', gif_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 12, parent_id: 1, slug: 'tablets', name: 'Tablets', is_active: true, sort_order: 2, image_url: 'https://x/c12.jpg', gif_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 21, parent_id: 2, slug: 'televisions', name: 'Televisions', is_active: true, sort_order: 1, image_url: 'https://x/c21.jpg', gif_url: null, placeholder_path: null, icon: null, color: null, description: null }
];

/* 1200 products: more than one PostgREST page. The OLDEST rows (which fall outside an un-ranged
   `order created_at desc` select) are the Electronics ones, so a non-paging client sees Electronics
   as empty even though its products exist and are readable. */
const prods = [];
for (let i = 1; i <= 1200; i++) {
  const phones = i <= 1150;
  const day = String((i % 27) + 1).padStart(2, '0');
  prods.push({
    id: i, name: (phones ? 'Phone ' : 'TV ') + i, price: 1000 + i, original_price: i % 3 === 0 ? 2000 + i : null,
    category: phones ? 'Phones & Tablets' : 'Electronics', category_id: phones ? (i % 2 ? 11 : 12) : 21,
    brand: null, brand_id: null, stock: 5, max_stock: 20, image_url: 'https://x/' + i + '.jpg', images: [],
    vendor_id: null, created_at: '2026-' + (phones ? '09' : '01') + '-' + day + 'T10:00:00Z',
    featured: false, flash_sale: false, colors: null
  });
}
prods.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

const tables = {
  products: prods, categories: catRows, banners: [], shortcuts: [],
  store_settings: [{ key: 'storeName', value: 'Marcato Test' }, { key: 'currency', value: 'N' }, { key: 'deliveryInfo', value: '1-2 days' }],
  vendors: [], ads: [], tiles: [], brands: [], product_ratings: [], reviews: [], worlds: [],
  beauty_heroes: [], beauty_categories: [], beauty_settings: [], order_items: [], favorites: []
};

function makeClient(counters) {
  function builder(table) {
    let rows = (tables[table] || []).slice();
    const st = {};
    const q = {
      select() { return q; }, eq(c, v) { rows = rows.filter(r => r[c] === v); return q; }, neq(c, v) { rows = rows.filter(r => r[c] !== v); return q; },
      in(c, vs) { rows = rows.filter(r => (Array.isArray(vs) ? vs : []).includes(r[c])); return q; }, or() { return q; },
      ilike(c, v) { rows = rows.filter(r => String(r[c] == null ? '' : r[c]).toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())); return q; },
      order(col, o) { const asc = !o || o.ascending !== false; rows.sort((a, b) => (a[col] === b[col] ? 0 : (a[col] < b[col] ? -1 : 1)) * (asc ? 1 : -1)); return q; },
      range(a, b) { st.ranged = true; rows = rows.slice(a, b + 1); return q; },
      gte(c, v) { rows = rows.filter(r => r[c] >= v); return q; }, lte(c, v) { rows = rows.filter(r => r[c] <= v); return q; },
      limit(n) { rows = rows.slice(0, n); return q; }, single() { st.single = true; return q; }, maybeSingle() { st.maybe = true; return q; },
      insert(arr) { st.ins = arr; return q; }, upsert(arr) { st.ins = arr; st.up = true; return q; }, update(o) { st.upd = o; return q; }, delete() { st.del = true; return q; },
      then(res) {
        if (st.ins) return Promise.resolve({ data: st.ins, error: null }).then(res);
        if (st.upd) rows.forEach(r => Object.assign(r, st.upd));
        if (st.del) tables[table] = tables[table].filter(r => !rows.includes(r));
        /* the server-side row cap that made the bug invisible in a small test database */
        if (!st.ranged) rows = rows.slice(0, PAGE_CAP);
        if (table === 'products') counters.productQueries++;
        return Promise.resolve({ data: (st.single || st.maybe) ? (rows[0] || null) : rows, error: null }).then(res);
      }
    };
    return q;
  }
  return {
    from: t => builder(t), rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } }), signInWithOAuth: async () => ({ data: null, error: { message: 'stub' } }), signOut: async () => ({})
    },
    storage: { from: () => ({ list: async () => ({ data: [] }), getPublicUrl: p => ({ data: { publicUrl: 'https://x/' + p } }) }) },
    channel: () => ({ on: () => ({ subscribe: () => { } }), subscribe: () => { } })
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

async function boot() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '');
  const errors = [];
  const counters = { productQueries: 0 };
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String((e && e.message) || e); if (!/no network|not found \/home|Could not load|Could not parse CSS/i.test(m)) errors.push(m.split('\n')[0]); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 400)));
  const dom = new JSDOM(html, {
    url: 'https://shop.test/index.html', runScripts: 'dangerously', resources: new LocalOnlyLoader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.supabase = { createClient: () => makeClient(counters) };
      w.matchMedia = q => ({ matches: false, media: q, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } });
      w.HTMLElement.prototype.scrollIntoView = function () { };
      w.scrollTo = function () { };
      w.IntersectionObserver = class { constructor() { } observe() { } unobserve() { } disconnect() { } };
    }
  });
  await new Promise(res => setTimeout(res, 1800));
  return { dom, w: dom.window, errors, counters };
}

const tick = ms => new Promise(res => setTimeout(res, ms));

test('every category resolves even when the catalogue is bigger than one PostgREST page (no false "No products yet")', async () => {
  const { dom, w, errors } = await boot();
  try {
    const $ = s => w.document.querySelector(s);
    const $$ = s => [...w.document.querySelectorAll(s)];
    const tab = n => $$('#catNavRow .cnTab').find(t => t.textContent === n);

    // Electronics products are the OLDEST rows, so an un-ranged select would drop every one of them
    const electronics = prods.filter(p => p.category_id === 21);
    assert.ok(prods.indexOf(electronics[0]) >= PAGE_CAP, 'the fixture really does put this category past the row cap');

    tab('Electronics').click();
    await tick(250);
    assert.equal($('#allGrid .empty'), null, 'a category whose products are all past the row cap is NOT reported empty');
    const names = $$('#allGrid .pcard .pcName').map(e => e.textContent);
    assert.ok(names.length > 0, 'the category grid rendered real products');
    assert.ok(names.every(n => n.startsWith('TV ')), 'only that category\'s products are shown: ' + names.slice(0, 3).join(', '));

    // and the whole category is reachable through the existing pagination, not just a first page
    for (let guard = 0; guard < 20 && $('#discoverMoreWrap').style.display !== 'none'; guard++) {
      $('#loadMoreBtn').click();
      await tick(20);
    }
    const shown = new Set($$('#allGrid .pcard .pcName').map(e => e.textContent));
    assert.equal(shown.size, electronics.length, 'every product in the category is reachable exactly once (' + shown.size + ' of ' + electronics.length + ')');

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally { dom.window.close(); }
});

test('a non-Home category renders subcategory tiles, then merchandising, then the product grid — in place', async () => {
  const { dom, w, errors } = await boot();
  try {
    const $ = s => w.document.querySelector(s);
    const $$ = s => [...w.document.querySelectorAll(s)];
    const tab = n => $$('#catNavRow .cnTab').find(t => t.textContent === n);

    // ── Home: a single continuous feed, nothing category-specific in it ──
    assert.equal($('#catRows'), null, 'no category catalogue rows in the Discover feed');
    assert.equal($('#catFilter'), null, 'no second scrollable category-navigation strip');
    assert.ok($('#catSubs').hasAttribute('hidden'), 'no subcategory tiles on Home');
    assert.ok($('#catMerch').hasAttribute('hidden'), 'no category merchandising on Home');
    assert.ok($('#allSecHd').hasAttribute('hidden'), 'no heading splitting the Home feed');

    tab('Phones & Tablets').click();
    await tick(250);

    // in place: same screen, no navigation, sticky bar keeps every tab one tap away
    assert.equal($('#catPage').classList.contains('open'), false, 'no separate category page opened');
    assert.equal(w.location.hash, '', 'no navigation happened, so there is nothing to press Back from');
    assert.ok(tab('Phones & Tablets').classList.contains('on'), 'the selected tab is marked active');
    assert.equal(tab('Phones & Tablets').getAttribute('aria-pressed'), 'true');
    assert.equal(tab('Home').getAttribute('aria-pressed'), 'false');

    // ── order: subcategory tiles -> merchandising -> product grid ──
    const kids = [...$('#allSec').children].filter(e => !e.hasAttribute('hidden'));
    const at = id => kids.findIndex(e => e.id === id);
    assert.ok(at('catSubs') === 0, 'circular subcategory tiles come first');
    assert.ok(at('catMerch') > at('catSubs'), 'merchandising comes after the subcategory tiles');
    assert.ok(kids.findIndex(e => e.classList.contains('pgrid-wrap')) > at('catMerch'), 'the product grid comes last');

    // (A) real subcategories, real configured images, no emoji/fabricated tiles
    const tiles = $$('#catSubs .cpg-tile');
    assert.deepEqual(tiles.map(t => t.querySelector('.cpg-name').textContent), ['Smartphones', 'Tablets'], 'real child categories, correct names');
    tiles.forEach(t => assert.ok(t.querySelector('.cat-thumb img'), 'the tile uses its configured image'));
    assert.ok(tiles.every(t => t.querySelector('.cat-thumb').classList.contains('round')), 'tiles are circular');

    // (B) merchandising: only sections that actually have products, no empty headings
    const rails = $$('#catMerch .cpg-msec');
    assert.ok(rails.length > 0, 'eligible merchandising sections rendered');
    rails.forEach(r => {
      assert.ok(r.querySelector('.cpg-msec-ttl').textContent.trim(), 'rail has a title');
      assert.ok(r.querySelectorAll('.fcard-wrap').length > 0, 'no empty merchandising heading: ' + r.querySelector('.cpg-msec-ttl').textContent);
      r.querySelectorAll('.pcard').forEach(c => assert.ok(!c.querySelector('.pcCtl'), 'merchandising cards keep the compact variant (no Add to Cart)'));
    });

    // (C) the standard 2-col product grid, with Add to Cart
    const cards = $$('#allGrid .pcard');
    assert.ok(cards.length > 0, 'the category product grid rendered');
    cards.forEach(c => assert.ok(c.querySelector('.pcCtl'), 'grid cards keep the standard variant (Add to Cart)'));
    assert.ok($$('#allGrid .pcard .pcName').every(n => n.textContent.startsWith('Phone ')), 'only this category\'s products');

    // ── switching again must not leak the previous category ──
    tab('Electronics').click();
    await tick(250);
    assert.deepEqual($$('#catSubs .cpg-tile').map(t => t.querySelector('.cpg-name').textContent), ['Televisions'], 'tiles are replaced, not appended');
    assert.ok($$('#allGrid .pcard .pcName').every(n => n.textContent.startsWith('TV ')), 'no products from the previous category remain');
    assert.ok($$('#catMerch .cpg-msec-ttl').every(t => !/Phones/.test(t.textContent)), 'no merchandising from the previous category remains');

    // ── and Home restores the untouched Discover feed ──
    tab('Home').click();
    await tick(250);
    assert.ok($('#catSubs').hasAttribute('hidden') && $('#catMerch').hasAttribute('hidden'), 'category content is cleared on Home');
    assert.ok($('#allSecHd').hasAttribute('hidden'), 'the Home feed has no category heading again');
    assert.ok(!w.document.body.classList.contains('cat-mode'), 'Home leaves category mode');

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally { dom.window.close(); }
});

test('a genuinely empty category shows a loading state first and "No products yet" only after the query', async () => {
  const { dom, w, errors } = await boot();
  try {
    const $ = s => w.document.querySelector(s);
    const $$ = s => [...w.document.querySelectorAll(s)];
    const tab = n => $$('#catNavRow .cnTab').find(t => t.textContent === n);

    tab('Garden').click();
    // synchronously after the tap: a loading state, never an empty state
    assert.equal($('#allGrid').getAttribute('aria-busy'), 'true', 'the grid announces it is loading');
    assert.ok($$('#allGrid .pcard-skel').length > 0, 'skeleton cards are shown while the category resolves');
    assert.equal($('#allGrid .empty'), null, '"No products yet" is never shown while still loading');

    await tick(250);
    assert.equal($('#allGrid').getAttribute('aria-busy'), null, 'the loading state is cleared once the query completes');
    assert.equal($$('#allGrid .pcard-skel').length, 0, 'skeletons are removed');
    assert.equal($('#allGrid .empty h3').textContent, 'No products yet', 'a truly empty category says so, after the query');
    assert.match($('#allGrid .empty p').textContent, /Garden/, 'the empty state names the category the shopper chose');
    // no fabricated content to make the category look populated
    assert.equal($$('#allGrid .pcard').length, 0, 'no unrelated products are padded in');
    assert.equal($$('#catMerch .cpg-msec').length, 0, 'no empty merchandising headings for a category with nothing in it');
    assert.ok($('#catSubs').hasAttribute('hidden'), 'no fabricated subcategory tiles for a category with no children');

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally { dom.window.close(); }
});
