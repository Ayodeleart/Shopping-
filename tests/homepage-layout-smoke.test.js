/* Integration smoke: boot the REAL index.html in jsdom (local scripts load from disk via file://)
   with an in-memory Supabase stub, then verify the Discover homepage:
     - the intended section order: Shop by Categories -> Explore -> Today's Deals (real flash-sale
       flag + the admin's countdown) -> Shop by Brand -> the merchandising rails (Now Trending,
       Best-Selling, New In, Sponsored, Featured, Brand Deals, Discounted, Category Products,
       Recommended for You) -> the continuous Discover feed -> Recently Viewed -> Vendors
     - every merchandising section renders only from REAL data (ratings, sold units, listing dates,
       the ads table, the featured flag, real markdowns/brands, the category tree) and is left out
       entirely when it has nothing to show — no empty headings, no invented content
     - merchandising rails are horizontally scrollable rows of COMPACT cards (no Add to Cart),
       each with a See All that leads to a real listing; category rows switch the surface in place
       exactly like the sticky bar
     - the Discover feed keeps loading incrementally to the footer, its cards keep Add to Cart,
       and category navigation stays exactly as it was (sticky bar, in-place switching)
*/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const catRows = [
  { id: 1, parent_id: null, slug: 'shoes', name: 'Shoes', is_active: true, sort_order: 1, image_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 2, parent_id: null, slug: 'clothing', name: 'Clothing', is_active: true, sort_order: 2, image_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 3, parent_id: null, slug: 'empty-cat', name: 'Empty Category', is_active: true, sort_order: 3, image_url: null, placeholder_path: null, icon: null, color: null, description: null }
];

/* 18 shoes (so the curated rows cap at 12 but the Discover feed still sees all of them),
   6 clothing items, 0 in the empty category, and 15 brands so the brand cap (12) is exercised.
   Real merchandising signals are spread across the catalogue: flash_sale flags, markdowns
   (original_price), ratings and sold units, plus one featured product. The two unbranded
   shirts carry markdowns no Brand Deals rail can claim, so Discounted Products has its own
   real stock however the no-repeat cascade lands. */
const prods = [];
for (let i = 1; i <= 18; i++) {
  prods.push({
    id: i, name: 'Shoe ' + i, price: 5000 + i, original_price: i % 3 === 0 ? 10000 + i : null, category: 'Shoes', category_id: 1,
    brand: 'Brand' + (i % 15 || 15), brand_id: (i % 15 || 15), stock: 5, max_stock: 20,
    image_url: 'https://x/shoe' + i + '.jpg', images: [], vendor_id: null,
    created_at: '2026-09-0' + (i % 9 || 1) + 'T10:00:00Z', featured: i === 1, flash_sale: i % 6 === 0
  });
}
for (let i = 1; i <= 6; i++) {
  prods.push({
    id: 100 + i, name: 'Shirt ' + i, price: 3000 + i, original_price: 6000 + i, category: 'Clothing', category_id: 2,
    brand: i <= 2 ? null : 'Brand' + i, brand_id: i <= 2 ? null : i, stock: 5, max_stock: 20,
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
    { key: 'deliveryInfo', value: '1-2 days' },
    { key: 'flashSaleEnd', value: String(Date.now() + 3600 * 1000) }
  ],
  vendors: [],
  ads: [
    { id: 501, name: 'Gap Sponsor', brand: 'Gap Ads', active: true, after_rows: 2, sort_order: 1,
      placement: 'section_gap', scope: 'home', category_id: null,
      accent: '#111', logo_url: '', feed_image: 'https://x/gap.jpg', feed_title: 'Gap Slot Deal',
      feed_sub: 'Between sections', feed_cta: 'Shop now', page: {} },
    { id: 502, name: 'Test Sponsor', brand: 'Sponsor Co', active: true, after_rows: 2, sort_order: 2,
      placement: 'feed', scope: 'home', category_id: null,
      accent: '#3f4468', logo_url: '', feed_image: 'https://x/ad.jpg', feed_title: 'Sponsored Deal',
      feed_sub: 'Limited time', feed_cta: 'Shop now', page: {} }
  ],
  tiles: [],
  brands: brands,
  product_ratings: [
    { product_id: 2, avg_rating: 4.8, review_count: 12 },
    { product_id: 3, avg_rating: 4.5, review_count: 8 },
    { product_id: 4, avg_rating: 4.9, review_count: 21 }
  ],
  reviews: [],
  worlds: [],
  beauty_heroes: [],
  beauty_categories: [],
  beauty_settings: [],
  order_items: [
    { product_id: 5, qty: 3, status: 'delivered' },
    { product_id: 6, qty: 2, status: 'pending' },
    { product_id: 7, qty: 1, status: 'cancelled' }   /* cancelled lines are not sales */
  ],
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

test('real index.html: Discover homepage (section order, real-data merchandising rails, compact cards, ad slots, incremental Discover feed)', async () => {
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
      w.scrollTo = function () {};   // category See All / Home switching scroll the surface (stubbed, as in sticky-home-catnav.test.js)
      w.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
    }
  });
  w = dom.window;

  await new Promise(res => setTimeout(res, 1500));
  const $ = s => w.document.querySelector(s);
  const $$ = s => [...w.document.querySelectorAll(s)];
  const tick = ms => new Promise(res => setTimeout(res, ms || 30));
  const posInMain = id => Array.prototype.indexOf.call($('#main').querySelectorAll('*'), w.document.getElementById(id));

  try {
    // ── overall section order ──
    const order = ['exploreSec', 'flashSec', 'brandSec', 'homeMerch', 'allSec', 'recentSec', 'vendorSec'];   // Shop by Categories floats inside the feed: see the placement checks below
    const positions = order.map(posInMain);
    assert.ok(positions.every(i => i >= 0), 'every Home section is present (' + order.join(', ') + ')');
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `${order[i]} should come after ${order[i - 1]} (got ${positions.join(',')})`);
    }

    // ── Shop by Categories sits INSIDE the product feed: Explore Marcato always first, then the admin's
    //    number of product rows (store_settings.shopCatsAfterRows, default 2) ──
    {
      const rowsBefore = () => {
        const pc = posInMain('shopCatsSec');
        return ['flashSec', 'recSec'].map(id => w.document.getElementById(id)).concat($$('#homeMerchRows > .hSec'))
          .filter(el => el && el.style.display !== 'none' && posInMain(el.id) >= 0 && posInMain(el.id) < pc).length;
      };
      const totalRows = () => ['flashSec', 'recSec'].map(id => w.document.getElementById(id)).concat($$('#homeMerchRows > .hSec'))
        .filter(el => el && el.style.display !== 'none').length;
      assert.ok(posInMain('shopCatsSec') > posInMain('exploreSec'), 'Explore Marcato comes before Shop by Categories');
      assert.ok(posInMain('shopCatsSec') < posInMain('allSec'), 'Shop by Categories is above the Discover feed');
      assert.equal(rowsBefore(), Math.min(2, totalRows()), 'default: two product rows before Shop by Categories');
      w.eval('shopCatsAfterRows = 0; placeShopCats();');
      assert.equal(rowsBefore(), 0, '0 = straight under Explore Marcato');
      assert.ok(posInMain('shopCatsSec') > posInMain('exploreSec'), 'still after Explore Marcato at 0');
      w.eval('shopCatsAfterRows = 1; placeShopCats();');
      assert.equal(rowsBefore(), Math.min(1, totalRows()), '1 = after the first product row');
      w.eval('shopCatsAfterRows = 99; placeShopCats();');
      assert.equal(rowsBefore(), totalRows(), 'more rows than exist = after the last one');
      assert.ok(posInMain('shopCatsSec') < posInMain('allSec'), 'never falls into the Discover grid');
      w.eval('shopCatsAfterRows = 2; placeShopCats();');
    }

    // ── Shop by Categories: the real main categories, placeholder tiles, See All ──
    const shopCats = $('#shopCatsSec');
    assert.ok(shopCats && shopCats.style.display !== 'none', 'Shop by Categories renders when main categories exist');
    const catTiles = $$('#shopCatsRow .cpg-tile');
    assert.deepEqual(catTiles.map(t => t.querySelector('.cpg-name').textContent), ['Shoes', 'Clothing', 'Empty Category'],
      'one circular tile per real main category, in the admin\'s sort order');
    catTiles.forEach(t => assert.ok(t.querySelector('.cat-thumb'), 'every tile shows the category placeholder (image or initial on its colour)'));
    assert.ok($('#shopCatsSec .secAll'), 'Shop by Categories has a See All');

    // ── Today's Deals: the real flash-sale flag + the admin's countdown ──
    const flashSec = $('#flashSec');
    assert.ok(flashSec && flashSec.style.display !== 'none', 'Today\'s Deals renders while flash-sale products exist');
    assert.match(flashSec.querySelector('.flashTtl').textContent, /Today's Deals/, 'the deals section is titled Today\'s Deals');
    assert.ok($('#cdWrap').style.display !== 'none', 'the configured countdown is shown');
    const flashNames = $$('#flashScroll .pcard .pcName').map(e => e.textContent);
    assert.ok(flashNames.length > 0, 'the deals row has cards');
    assert.ok(flashNames.every(n => /^Shoe (6|12|18)$/.test(n)), 'only real flash_sale products are in it: ' + flashNames.join(', '));
    assert.ok($('#flashSeeAll'), 'Today\'s Deals has a See All');

    // ── the merchandising rails: order, real data only, no empty headings ──
    const railOrder = ['trendSec', 'bestSec', 'newSec', 'sponSec', 'featSec', 'brandDealsSec', 'discSec'];
    const railPos = railOrder.map(id => posInMain(id));
    assert.ok(railPos.every(i => i >= 0), 'every eligible merchandising rail rendered (no missing section)');
    for (let i = 1; i < railOrder.length; i++) {
      assert.ok(railPos[i] > railPos[i - 1], `${railOrder[i]} comes after ${railOrder[i - 1]}`);
    }
    $$('#homeMerchRows .hSec').forEach(sec => {
      const title = sec.querySelector('.secTtl').textContent.trim();
      assert.ok(title, 'every rail has a heading');
      const hasContent = sec.querySelectorAll('.hScroll .pcard').length > 0 ||
        (sec.id === 'sponSec' && sec.querySelector('.adslot'));
      assert.ok(hasContent, 'no empty merchandising heading: ' + title);
      sec.querySelectorAll('.pcard').forEach(c =>
        assert.ok(!c.querySelector('.pcCtl'), 'merchandising cards stay compact (no Add to Cart): ' + title));
    });

    // Now Trending = real ratings only
    const trendNames = $$('#trendSec .pcard .pcName').map(e => e.textContent);
    assert.deepEqual(trendNames, ['Shoe 4', 'Shoe 2', 'Shoe 3'], 'Now Trending shows the rated products, best first');
    // Best-Selling = real sold units only (cancelled lines are not sales)
    const bestNames = $$('#bestSec .pcard .pcName').map(e => e.textContent);
    assert.deepEqual(bestNames, ['Shoe 5', 'Shoe 6'], 'Best-Selling shows really-sold products, most sold first');
    // Featured = the real featured flag
    assert.deepEqual($$('#featSec .pcard .pcName').map(e => e.textContent), ['Shoe 1'], 'Featured shows the admin\'s featured product');
    // Brand Deals = real markdown + resolvable brand, nothing already shown higher up the page
    const brandDealNames = $$('#brandDealsSec .pcard .pcName').map(e => e.textContent);
    assert.ok(brandDealNames.length > 0, 'Brand Deals renders while branded markdowns exist');
    assert.ok(brandDealNames.every(n => /^Shoe \d+$|^Shirt [3-6]$/.test(n)), 'Brand Deals shows only branded, discounted products: ' + brandDealNames.join(', '));
    // Discounted = the real markdowns the higher rails did not claim
    const discNames = $$('#discSec .pcard .pcName').map(e => e.textContent);
    assert.deepEqual(discNames.slice().sort(), ['Shirt 1', 'Shirt 2'], 'Discounted shows the remaining real markdowns');
    // Sponsored = the admin's real feed ad, and that ad is NOT also interleaved in the Discover feed
    assert.ok($('#sponSec .adslot'), 'Sponsored renders the ad card from the real ads table');
    assert.equal($$('#allGrid .adslot').length, 0, 'a sponsored ad shown in its rail is not repeated inside the Discover feed');

    // rails are horizontally scrollable rows with See All where supported
    $$('#homeMerchRows .hSec .hScroll').forEach(row =>
      assert.equal(w.getComputedStyle(row).display, 'flex', 'merchandising rows are horizontal (flex) rows'));
    ['trendSec', 'bestSec', 'newSec', 'featSec', 'brandDealsSec', 'discSec'].forEach(id =>
      assert.ok(w.document.getElementById(id).querySelector('.secAll'), id + ' has a See All action'));

    // a rail's See All opens that section's FULL list in the browsing surface
    $('#trendSec .secAll').click();
    await tick();
    assert.equal($('#allSecTitle').textContent, 'Now Trending', 'See All retitles the browsing surface');
    assert.ok($$('#allGrid .pcard').length >= 3, 'See All lists the full section, not just the rail');

    // back to Home through the sticky bar (category navigation unchanged)
    $$('#catNavRow .cnTab').find(t => t.textContent === 'Home').click();
    await tick(250);
    assert.equal($$('#allGrid .pcard .pcName').length > 0, true, 'Home restores the continuous Discover feed');

    // ── Category Products: one rail per stocked main category, switching the surface in place ──
    const catRails = $$('#homeMerchRows .hCatSec');
    assert.deepEqual(catRails.map(r => r.querySelector('.secTtl').textContent), ['Shoes', 'Clothing'],
      'one rail per main category that actually has products (the empty category is left out)');
    catRails.forEach(r => {
      assert.ok(r.querySelector('.secAll'), 'each category rail has a See All');
      assert.ok(r.querySelectorAll('.hScroll .pcard').length > 0, 'no empty category rail');
    });
    assert.ok($$('#hcat-2 .pcard .pcName').map(e => e.textContent).every(n => /^Shirt /.test(n)), 'a category rail shows only that category\'s products');
    $('#hcat-2 .secAll').click();                       // See All on a category rail = the sticky bar's own behaviour
    await tick(250);
    assert.ok(w.document.body.classList.contains('cat-mode'), 'a category See All switches the surface to category mode, in place');
    assert.equal($('#allSecTitle').textContent, 'Clothing', 'the surface retitles to the category');
    $$('#catNavRow .cnTab').find(t => t.textContent === 'Home').click();
    await tick(250);
    assert.ok(!w.document.body.classList.contains('cat-mode'), 'Home leaves category mode');

    // ── Recommended for You / Recently Viewed: this device's real history only ──
    assert.equal($('#recSec').style.display, 'none', 'Recommended for You is hidden with no browsing history (nothing invented)');
    assert.equal($('#recentSec').style.display, 'none', 'Recently Viewed is hidden with no history');

    // ── the Discover feed: still one continuous, incremental feed to the footer ──
    assert.ok($('#allSecHd').hasAttribute('hidden'), 'no heading splitting the Home feed');
    assert.ok($('#catSubs').hasAttribute('hidden') && $('#catMerch').hasAttribute('hidden'), 'no category content inside the feed on Home');
    assert.ok($('#catNav'), 'the sticky category bar is the sole category switcher');
    assert.equal($('#catRows'), null, 'no legacy category-catalogue markup in the feed');
    assert.equal($$('.catRowSec').length, 0, 'category rails live above the feed, not inside it');
    assert.equal($('#catFilter'), null, 'no second scrollable category-navigation strip besides the sticky bar');

    const allGrid = $('#allGrid');
    const idsOf = () => $$('#allGrid .pcard').map(c => c.getAttribute('onclick'));
    const firstBatchIds = idsOf();
    assert.ok(firstBatchIds.length > 0 && firstBatchIds.length < prods.length, 'first paint shows a batch, not the whole catalogue (' + firstBatchIds.length + ' of ' + prods.length + ')');
    const loadMoreWrap = $('#discoverMoreWrap');
    assert.ok(loadMoreWrap && loadMoreWrap.style.display !== 'none', 'Load More is visible while more products remain');
    $('#loadMoreBtn').click();
    await tick();
    const secondBatchIds = idsOf();
    assert.ok(secondBatchIds.length > firstBatchIds.length, 'Load More appends more products');
    const asSet = new Set(secondBatchIds);
    assert.equal(asSet.size, secondBatchIds.length, 'no duplicate products after Load More');
    // keep loading until everything is shown, then confirm nothing duplicated and every product id is unique
    for (let guard = 0; guard < 10 && $('#discoverMoreWrap').style.display !== 'none'; guard++) {
      $('#loadMoreBtn').click();
      await tick(20);
    }
    const finalIds = new Set(idsOf());
    assert.equal(finalIds.size, prods.length, 'every product eventually shown exactly once, none dropped or duplicated');

    // ── favorites/cart still work on incrementally-loaded cards ──
    const firstCard = $('#allGrid .pcard');
    const addBtn = firstCard.querySelector('.pcAdd, .pcStepB');
    assert.ok(addBtn, 'cart control present on a card from the paginated feed');

    // ── opening a product fills Recently Viewed and Recommended for You ──
    w.openProduct(2);
    await tick(120);
    assert.equal($('#recentSec').style.display, '', 'Recently Viewed appears once there is real history');
    assert.deepEqual($$('#recentSec .pcard .pcName').map(e => e.textContent), ['Shoe 2'], 'Recently Viewed shows what was actually opened');
    assert.equal($('#recSec').style.display, '', 'Recommended for You appears from the same real history');
    assert.ok($$('#recRow .pcard .pcName').every(n => n !== 'Shoe 2'), 'the product just opened is not recommended straight back');
    assert.ok($$('#recRow .pcard .pcName').length > 0, 'recommendations come from the shopper\'s own categories/brands');
    w.closePModal(true);

    // ── Shop by Brand: ONE compact strip, capped to a manageable number; See All reveals the rest as a grid ──
    const brandRow = $('#brandRow');
    assert.equal(w.getComputedStyle(brandRow).display, 'flex', 'brand row is one compact horizontal strip');
    const bcards = $$('.bcard');
    assert.ok(bcards.length > 0 && bcards.length <= 12, 'a manageable, capped number of brands (got ' + bcards.length + ')');
    assert.ok($('#brandSec .secHd--accent'), 'Shop by Brand uses the shared coloured section header');
    assert.ok($('#recSec .secHd--accent'), 'Recommended for You uses the shared coloured section header');

    // ── ad between curated sections, reusing the real ads table/admin controls ──
    const slotA = $('#homeAdSlotA');
    assert.ok(slotA && slotA.style.display !== 'none', 'an ad slot renders between curated sections when an ad is configured');
    assert.ok(slotA.querySelector('.adslot'), 'ad slot uses the existing ad-card rendering');

    const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
    assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally {
    if (w) w.close();
  }
});
