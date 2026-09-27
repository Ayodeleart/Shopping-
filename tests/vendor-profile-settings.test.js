/* Integration smoke: boot the REAL vendor/index.html in jsdom and verify the Store Profile
 * settings panel (Phase 5, item 6) actually shows the real data collected during onboarding
 * (address, description, contact, verification status) instead of just logo/name/phone, and
 * that saving from this panel never sends back status/application_status/verification fields
 * a vendor is not allowed to change themselves. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const VENDOR_ROW = {
  id: 'vendor-1', business_name: 'Test Vendor', store_slug: 'test-vendor',
  email: 'vendor@example.com', phone: '08012345678', logo_url: null,
  status: 'approved', application_status: 'approved',
  store_description: 'We sell fine leather bags.',
  address: '14 Allen Avenue', state: 'Lagos', lga: 'Ikeja', city: 'Ikeja', landmark: 'Near the mall',
  id_verification_status: 'verified', bank_verification_status: 'pending'
};

function makeClient(capture) {
  const tables = { vendors: [Object.assign({}, VENDOR_ROW)], products: [], orders: [], order_items: [], reviews: [], product_ratings: [], categories: [], store_settings: [] };
  function builder(table) {
    if (!tables[table]) tables[table] = [];
    let rows = tables[table].slice();
    const st = {};
    const q = {
      select() { return q; }, eq(c, v) { rows = rows.filter(r => r[c] === v); return q; },
      neq(c, v) { rows = rows.filter(r => r[c] !== v); return q; },
      in(c, vs) { rows = rows.filter(r => (Array.isArray(vs) ? vs : []).includes(r[c])); return q; },
      or() { return q; }, ilike() { return q; }, order() { return q; }, range() { return q; }, limit(n) { rows = rows.slice(0, n); return q; },
      single() { st.single = true; return q; }, maybeSingle() { st.maybe = true; return q; },
      insert(arr) { st.ins = arr; return q; }, upsert(arr) { st.ins = arr; st.up = true; return q; },
      update(o) { st.upd = o; if (table === 'vendors') capture.push(o); return q; },
      delete() { st.del = true; return q; },
      then(res) {
        if (st.ins) { tables[table] = st.up ? tables[table] : tables[table].concat(st.ins); return Promise.resolve({ data: st.ins, error: null }).then(res); }
        if (st.upd) rows.forEach(r => Object.assign(r, st.upd));
        if (st.del) tables[table] = tables[table].filter(r => !rows.includes(r));
        return Promise.resolve({ data: (st.single || st.maybe) ? (rows[0] || null) : rows, error: null }).then(res);
      }
    };
    return q;
  }
  const session = { user: { id: 'vendor-1', email: 'vendor@example.com' }, access_token: 'stub-token' };
  return {
    from: t => builder(t), rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session } }), getUser: async () => ({ data: { user: session.user } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ data: null, error: { message: 'stub' } }), signOut: async () => ({})
    },
    storage: { from: () => ({ list: async () => ({ data: [] }), upload: async p => ({ data: { path: p } }), getPublicUrl: p => ({ data: { publicUrl: 'https://x/' + p } }) }) },
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
  };
}

class LocalOnlyLoader extends ResourceLoader {
  fetch(url) {
    if (url.startsWith('https://vendor.test/')) {
      const p = path.join(ROOT, new URL(url).pathname);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
      return Promise.reject(new Error('not found ' + p));
    }
    return Promise.reject(new Error('no network in vendor profile smoke: ' + url));
  }
}

test('vendor Store Profile panel: shows real onboarding data and never saves protected fields', async () => {
  const htmlPath = path.join(ROOT, 'vendor', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8')
    .replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '')
    .replace(/<script src="https:\/\/unpkg\.com\/leaflet[^"]*"><\/script>/, '');
  const url = 'https://vendor.test/vendor/index.html';
  const capturedUpdates = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String((e && e.message) || e);
    if (!/no network|not found \/home|Could not load|Could not parse CSS|vendor profile smoke|unpkg|leaflet/i.test(m)) errors.push(m.split('\n')[0]);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 300)));
  let w;
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', resources: new LocalOnlyLoader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.supabase = { createClient: () => makeClient(capturedUpdates) };
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.HTMLElement.prototype.scrollIntoView = function () {};
      win.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
      win.fetch = async () => { throw new Error('no network in vendor profile smoke'); };
    }
  });
  w = dom.window;

  try {
    await new Promise(res => setTimeout(res, 1800));

    /* the onboarding data must actually reach the settings form, not just the onboarding wizard */
    assert.equal(w.document.getElementById('sName').value, 'Test Vendor');
    assert.equal(w.document.getElementById('sEmail').value, 'vendor@example.com');
    assert.equal(w.document.getElementById('sDesc').value, 'We sell fine leather bags.');
    assert.equal(w.document.getElementById('sAddress').value, '14 Allen Avenue');
    assert.equal(w.document.getElementById('sState').value, 'Lagos');
    assert.equal(w.document.getElementById('sLga').value, 'Ikeja');
    assert.equal(w.document.getElementById('sCity').value, 'Ikeja');
    assert.equal(w.document.getElementById('sLandmark').value, 'Near the mall');
    assert.match(w.document.getElementById('sStoreUrl').value, /test-vendor/);

    /* verification status is shown, honestly reflecting the seeded data, not invented */
    assert.match(w.document.getElementById('sStatusBadge').textContent, /Approved/);
    assert.match(w.document.getElementById('sIdStatusBadge').textContent, /Verified/);
    assert.match(w.document.getElementById('sBankStatusBadge').textContent, /Pending/);

    /* saving must only ever touch the fields a vendor is allowed to edit */
    w.document.getElementById('sName').value = 'Updated Vendor Name';
    w.document.getElementById('sSaveBtn').onclick();
    await new Promise(res => setTimeout(res, 50));

    assert.ok(capturedUpdates.length >= 1, 'Save should have issued a vendors update');
    const patch = capturedUpdates[capturedUpdates.length - 1];
    const forbidden = ['status', 'application_status', 'id_verification_status', 'bank_verification_status', 'id_verification_number', 'bank_account_number', 'email'];
    forbidden.forEach(f => assert.ok(!(f in patch), `save payload must never include "${f}"`));
    assert.equal(patch.business_name, 'Updated Vendor Name');
  } finally {
    if (w) w.close();
  }

  const fatal = errors.filter(m => !/no network|vendor profile smoke|unpkg|leaflet/i.test(m));
  assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.slice(0, 5).join(' | '));
});
