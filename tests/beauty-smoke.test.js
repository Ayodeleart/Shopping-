/* Integration smoke: boot the REAL index.html in jsdom (local scripts load from
   disk via file://) with an in-memory Supabase stub, then verify #world=beauty
   renders the Beauty world from the real page wiring (init fetches, world-page
   delegation, product-page theming). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const catRows = [
  { id: 1, parent_id: null, slug: 'beauty', name: 'Beauty', is_active: true, sort_order: 990, image_url: null, placeholder_path: null, icon: null, color: null, description: null },
  { id: 2, parent_id: 1, slug: 'makeup', name: 'Makeup', is_active: true, sort_order: 1 },
  { id: 3, parent_id: 2, slug: 'lipstick', name: 'Lipstick', is_active: true, sort_order: 1 },
  { id: 4, parent_id: null, slug: 'food', name: 'Food', is_active: true, sort_order: 1 }
];
const prods = [
  { id: 11, name: 'Viva Glam Lipstick', price: 5000, original_price: 6000, category: 'Lipstick', category_id: 3, brand: 'MAC', stock: 8, max_stock: 0, description: 'A real lipstick.', image_url: 'https://x/a.jpg', images: ['https://x/a.jpg'], beauty_image_url: 'https://x/cut.png', vendor_id: null, created_at: '2026-09-10T10:00:00Z', featured: false, flash_sale: false, attributes: {} },
  { id: 12, name: 'Rice 5kg', price: 8000, original_price: null, category_id: 4, brand: null, stock: 2, image_url: 'https://x/r.jpg', images: [], vendor_id: null, created_at: '2026-09-12T10:00:00Z' }
];
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
  ads: [],
  tiles: [],
  brands: [],
  product_ratings: [{ product_id: 11, avg_rating: 4.5, review_count: 2 }],
  reviews: [{ id: 1, product_id: 11, user_id: 'u1', name: 'Ada', rating: 5, comment: 'Nice', created_at: '2026-09-01' }],
  worlds: [{ slug: 'food', image_url: null }, { slug: 'beauty', image_url: null }],
  beauty_heroes: [
    { id: 1, image_url: 'https://x/h1.gif', title: 'Glow Season', subtitle: 'Real brands', cta_text: 'Shop', link_url: '#cat=lipstick', sort_order: 10, active: true, created_at: null, updated_at: null },
    { id: 2, image_url: 'https://x/h2.jpg', title: 'Skincare', subtitle: 'Daily basics', cta_text: null, link_url: null, sort_order: 20, active: true, created_at: null, updated_at: null }
  ],
  beauty_categories: [
    { id: 1, name: 'All', slug: 'all', kind: 'all', category_id: null, keywords: null, image_url: null, sort_order: 10, active: true },
    { id: 2, name: 'Makeup', slug: 'makeup', kind: 'category', category_id: 2, keywords: 'makeup', image_url: null, sort_order: 40, active: true }
  ],
  beauty_settings: [{ key: 'background_url', value: 'https://x/bg.jpg' }, { key: 'background_enabled', value: '1' }],
  order_items: [{ product_id: 11, qty: 3, status: 'completed' }],
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

test('real index.html: #world=beauty boots the Beauty world from real wiring', async () => {
  const htmlPath = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8')
    // the CDN supabase script cannot load offline; the stub below takes its place
    .replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '');
  const url = 'https://shop.test/index.html#world=beauty';
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
      // jsdom has no IntersectionObserver (browsers do) — a no-op stub is enough for boot
      w.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
    }
  });
  w = dom.window;

  // wait for: scripts to load + init() to finish + world deep-link to open
  await new Promise(res => setTimeout(res, 1500));
  const $ = s => w.document.querySelector(s);

  try {
  assert.ok(w.Pcx && w.Pcx.BeautyData && w.Pcx.BeautyWorld, 'beauty modules loaded');
  assert.ok($('#worldPage') && $('#worldPage').classList.contains('open'), 'world page opened from #world=beauty');
  assert.ok($('.bw-root'), 'Beauty world mounted by the real page delegation');
  assert.ok($('.bw-searchbtn'), 'premium beauty search bar');
  assert.equal(w.document.querySelectorAll('[data-bw-grid] .pcard').length, 1, 'only the real beauty product');
  assert.ok(w.document.querySelector('[data-bw-grid] .pcImg img').src.includes('cut.png'), 'cutout photo on the card');
  assert.equal(w.document.querySelectorAll('.bw-tile').length, 2, 'two active admin tiles');
  assert.ok(w.document.querySelector('.bw-hero .pcx__slide'), 'hero carousel rendered from beauty_heroes');
  assert.ok(w.document.querySelector('.bw-bg-img').style.backgroundImage.includes('bg.jpg'), 'admin background image applied');
  assert.equal(w.document.querySelectorAll('.pcx__dot').length, 2, 'two admin hero slides -> two dots');
  assert.equal(w.document.querySelectorAll('.pcx__nav').length, 2, 'multi-slide hero has prev/next controls');
  const heroImgs = [...w.document.querySelectorAll('.bw-hero .pcx__slide .pcx__img')].map(i => i.src);
  assert.ok(heroImgs.some(s => s.includes('h1.gif')), 'hero image kept as-is (GIFs animate)');

  // product page: themed for beauty, cutout main image, no thumbnails with 1 photo
  w.openProduct(11);
  await new Promise(res => setTimeout(res, 80));
  const modal = $('#pModal');
  assert.ok(modal.classList.contains('bw-theme'), 'product page gets the beauty glass theme');
  assert.ok(modal.style.getPropertyValue('--bw-bg-img').includes('bg.jpg'), 'beauty background on product page');
  assert.ok(modal.querySelector('.pgal__img').src.includes('cut.png'), 'cutout as main gallery photo');
  assert.equal(modal.querySelectorAll('.pgal__thumb').length, 0, 'no empty thumbnail strip for a single photo');
  assert.ok(modal.querySelector('#pModalWas'), 'real previous price shown');
  w.closePModal(true);
  assert.ok(!modal.classList.contains('bw-theme'), 'theme cleaned up on close');

  // non-beauty product: untouched styling
  w.openProduct(12);
  await new Promise(res => setTimeout(res, 40));
  assert.ok(!$('#pModal').classList.contains('bw-theme'), 'non-beauty product page not themed');
  w.closePModal(true);

  // no fatal script errors from the boot
  const fatal = errors.filter(m => !/no network|supabase|Failed to fetch/i.test(m));
  assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.join(' | '));
  } finally {
    if (w) w.close(); // stop the page's timers so the test process can exit
  }
});
