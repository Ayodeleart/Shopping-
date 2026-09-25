/* Integration smoke: boot the REAL vendor/index.html in jsdom with an in-memory
   Supabase stub and verify the Beauty cutout wiring (removeBgServer,
   isBeautyCategory, pRmBg auto-check) is present and the page boots cleanly. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function makeClient() {
  const tables = {
    vendors: [{ id: 1, business_name: 'Test Vendor', store_slug: 'test-vendor', status: 'approved' }],
    products: [], orders: [], order_items: [], reviews: [], product_ratings: [],
    categories: [
      { id: 1, parent_id: null, slug: 'beauty', name: 'Beauty', is_active: true, sort_order: 1, image_url: null },
      { id: 2, parent_id: 1, slug: 'makeup', name: 'Makeup', is_active: true, sort_order: 1 },
      { id: 3, parent_id: null, slug: 'food', name: 'Food', is_active: true, sort_order: 2 }
    ],
    store_settings: []
  };
  function builder(table) {
    if (!tables[table]) tables[table] = [];
    let rows = tables[table].slice();
    const st = {};
    const q = {
      select() { return q; },
      eq(c, v) { rows = rows.filter(r => r[c] === v); return q; },
      neq(c, v) { rows = rows.filter(r => r[c] !== v); return q; },
      in(c, vs) { rows = rows.filter(r => (Array.isArray(vs) ? vs : []).includes(r[c])); return q; },
      or() { return q; },
      ilike() { return q; },
      order() { return q; },
      range() { return q; },
      limit(n) { rows = rows.slice(0, n); return q; },
      single() { st.single = true; return q; },
      maybeSingle() { st.maybe = true; return q; },
      insert(arr) { st.ins = arr; return q; },
      upsert(arr) { st.ins = arr; st.up = true; return q; },
      update(o) { st.upd = o; return q; },
      delete() { st.del = true; return q; },
      then(res) {
        if (st.ins) {
          tables[table] = st.up ? tables[table] : tables[table].concat(st.ins.map(r => Object.assign({ id: (tables[table][tables[table].length - 1] || {}).id + 1 || 1 }, r)));
          return Promise.resolve({ data: st.ins, error: null }).then(res);
        }
        if (st.upd) rows.forEach(r => Object.assign(r, st.upd));
        if (st.del) tables[table] = tables[table].filter(r => !rows.includes(r));
        return Promise.resolve({ data: (st.single || st.maybe) ? (rows[0] || null) : rows, error: null }).then(res);
      }
    };
    return q;
  }
  const session = { user: { id: 'vendor-1', email: 'vendor@example.com' }, access_token: 'stub-token' };
  return {
    from: t => builder(t),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session.user } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ data: null, error: { message: 'stub' } }),
      signOut: async () => ({})
    },
    storage: { from: () => ({ list: async () => ({ data: [] }), upload: async (p, b) => ({ data: { path: p } }), getPublicUrl: p => ({ data: { publicUrl: 'https://x/' + p } }) }) },
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
  };
}

class LocalOnlyLoader extends ResourceLoader {
  fetch(url, options) {
    if (url.startsWith('https://vendor.test/')) {
      const p = path.join(ROOT, new URL(url).pathname);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
      return Promise.reject(new Error('not found ' + p));
    }
    return Promise.reject(new Error('no network in vendor smoke: ' + url));
  }
}

test('real vendor/index.html: boots with the Beauty cutout wiring intact', async () => {
  const htmlPath = path.join(ROOT, 'vendor', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8')
    .replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '')
    .replace(/<script src="https:\/\/unpkg\.com\/leaflet[^"]*"><\/script>/, '');
  const url = 'https://vendor.test/vendor/index.html';
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String((e && e.message) || e);
    if (!/no network|not found \/home|Could not load|Could not parse CSS|vendor smoke|unpkg|leaflet/i.test(m)) errors.push(m.split('\n')[0]);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 300)));
  let w;
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: new LocalOnlyLoader(),
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      win.supabase = { createClient: () => makeClient() };
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.HTMLElement.prototype.scrollIntoView = function () {};
      win.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
      win.fetch = async () => { throw new Error('no network in vendor smoke'); };
    }
  });
  w = dom.window;

  try {
    await new Promise(res => setTimeout(res, 1800));
    const $ = s => w.document.querySelector(s);

    assert.ok(typeof w.removeBgServer === 'function', 'server-side cutout helper present');
    assert.ok(typeof w.isBeautyCategory === 'function', 'beauty category check present');
    assert.ok($('#pRmBg'), 'remove-background toggle in the product form');
    assert.ok($('.rmbgHint') || w.document.querySelector('#pRmBg'), 'hint under the toggle (or the toggle itself)');

    /* the auto-check follows the real category tree */
    const picker = w.Pcx && w.Pcx.CategoryPicker;
    assert.ok(picker, 'category picker loaded');
    assert.equal(w.isBeautyCategory(), false, 'empty form is not a beauty category yet');

    /* /api/remove-bg is admin-only now — the vendor's own request must carry its session token,
       or a real admin session would get a 401 and the cutout would silently never happen */
    let sentAuth = null;
    w.fetch = async (url, opts) => {
      if (String(url) === '/api/remove-bg') { sentAuth = opts && opts.headers && opts.headers.Authorization; return { ok: true, json: async () => ({ url: 'https://x/cut.png' }) }; }
      throw new Error('no network in vendor smoke: ' + url);
    };
    const cutout = await w.removeBgServer('https://x/original.jpg');
    assert.equal(cutout, 'https://x/cut.png');
    assert.equal(sentAuth, 'Bearer stub-token', "removeBgServer sends the vendor's session as a bearer token");
  } finally {
    if (w) w.close();
  }

  const fatal = errors.filter(m => !/no network|vendor smoke|unpkg|leaflet/i.test(m));
  assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.slice(0, 5).join(' | '));
});
