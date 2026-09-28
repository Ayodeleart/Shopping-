/* Integration smoke: boots the REAL store/store.js (via store/index.html) and verifies the
 * Phase 5 item 3 fix. Tapping a product used to do a bare `location.href = '/?p=ID'` full-page
 * navigation with no memory of where the customer was, so returning always reset the store to
 * page one with no category/search/sort/scroll restored, and the product page's own Back arrow
 * had nothing to return to (it just closed onto the main homepage). This test checks:
 *   1. choosing a category saves that browsing state under a key scoped to this store,
 *   2. loading the store again with that state already in sessionStorage restores the category,
 *      search text and sort control — proving the restore path is wired to the real controls,
 *   3. opening a product saves state and hands off a validated, same-origin "from" back-link,
 *   4. index.html's guard on that "from" value rejects an external URL (open-redirect guard).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const VENDOR = { id: 1, business_name: 'Leather & Co', store_slug: 'leather-co', logo_url: null, store_description: '', city: '', state: '', status: 'approved', application_status: 'approved', created_at: new Date().toISOString() };
const PRODUCTS = [
  { id: 101, name: 'Brown Bag', price: 5000, category: 'Bags', vendor_id: 1, stock: 5, max_stock: 5, image_url: null, featured: false, flash_sale: false, created_at: new Date().toISOString() },
  { id: 102, name: 'Black Belt', price: 2000, category: 'Belts', vendor_id: 1, stock: 5, max_stock: 5, image_url: null, featured: false, flash_sale: false, created_at: new Date().toISOString() }
];

function makeClient() {
  function builder(table) {
    let rows = (table === 'vendors' || table === 'vendors_public' ? [VENDOR] : table === 'products' ? PRODUCTS : []).slice();
    let opts = {};
    const q = {
      select(_c, o) { opts = o || {}; return q; },
      eq(c, v) { rows = rows.filter(r => r[c] === v); return q; },
      in(c, vs) { rows = rows.filter(r => (vs || []).includes(r[c])); return q; },
      ilike(c, pat) { const needle = String(pat).replace(/%/g, '').toLowerCase(); rows = rows.filter(r => String(r[c] || '').toLowerCase().includes(needle)); return q; },
      order() { return q; }, range() { return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
      then(res) { return Promise.resolve({ data: rows, count: opts.count ? rows.length : undefined, error: null }).then(res); }
    };
    return q;
  }
  return { from: t => builder(t) };
}

class LocalOnlyLoader extends ResourceLoader {
  fetch(url) {
    if (url.startsWith('https://shop.test/')) {
      const p = path.join(ROOT, new URL(url).pathname);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
      return Promise.reject(new Error('not found ' + p));
    }
    return Promise.reject(new Error('no network in store smoke: ' + url));
  }
}

/* @param {object|null} seed - pre-existing sessionStorage state, as if the customer is returning */
async function bootStore(seed) {
  const html = fs.readFileSync(path.join(ROOT, 'store', 'index.html'), 'utf8');
  const url = 'https://shop.test/store/leather-co';
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', resources: new LocalOnlyLoader(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.supabase = { createClient: () => makeClient() };
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
      win.updateCartBadge = () => {};
      if (seed) win.sessionStorage.setItem('mct_store_state:leather-co', JSON.stringify(seed));
    }
  });
  await new Promise(res => setTimeout(res, 400));
  return dom.window;
}

test('vendor store: choosing a category saves browsing state scoped to this store', async () => {
  const w = await bootStore(null);
  try {
    const belts = [...w.document.querySelectorAll('.catPill')].find(b => b.textContent === 'Belts');
    assert.ok(belts, 'category pill for Belts should render from the seeded products');
    belts.click();
    await new Promise(r => setTimeout(r, 20));

    const saved = JSON.parse(w.sessionStorage.getItem('mct_store_state:leather-co'));
    assert.ok(saved, 'a browsing-state entry is saved for this store');
    assert.equal(saved.activeCategory, 'Belts');
  } finally { w.close(); }
});

test('vendor store: returning with saved state restores category, search and sort into the real controls', async () => {
  const w = await bootStore({ activeCategory: 'Belts', search: 'black', sort: 'price_asc', scrollY: 300 });
  try {
    const onPill = w.document.querySelector('.catPill.on');
    assert.equal(onPill && onPill.textContent, 'Belts', 'the previously-chosen category pill is marked active on return');
    assert.equal(w.document.getElementById('searchInput').value, 'black', 'search box reflects the restored text');
    assert.equal(w.document.getElementById('sortSelect').value, 'price_asc', 'sort control reflects the restored order');
    // the search filter actually applied to the loaded products, not just to the input's value
    const grid = w.document.getElementById('grid').textContent;
    assert.match(grid, /Black Belt/);
    assert.doesNotMatch(grid, /Brown Bag/);
  } finally { w.close(); }
});

test('vendor store: opening a product saves state before navigating, with an encoded same-origin back-link', async () => {
  const w = await bootStore(null);
  try {
    // jsdom does not implement real page navigation; setting location.href logs a
    // "Not implemented" notice instead of throwing, which is expected here and not a bug.
    w.openProduct(101);
    await new Promise(r => setTimeout(r, 20));

    const saved = JSON.parse(w.sessionStorage.getItem('mct_store_state:leather-co'));
    assert.ok(saved, 'state is saved before navigating away to the product');
  } finally { w.close(); }

  // jsdom's Location object cannot be intercepted (non-configurable own accessors), so the
  // exact URL construction is verified directly against the shipped source instead.
  const src = fs.readFileSync(path.join(ROOT, 'store', 'store.js'), 'utf8');
  assert.match(src, /const back = encodeURIComponent\(location\.pathname \+ location\.search\);/, 'the back-link is built from this store\'s own path, then encoded');
  assert.match(src, /location\.href = '\/\?p=' \+ id \+ '&from=' \+ back;/, 'the product hand-off carries the encoded back-link');
});

test('vendor store: "Back to Marcato" prefers history.back() over a fresh reload when arriving from Marcato itself', async () => {
  const w = await bootStore(null);
  try {
    Object.defineProperty(w.document, 'referrer', { value: 'https://shop.test/', configurable: true });
    Object.defineProperty(w.history, 'length', { value: 2, configurable: true });
    let wentBack = false;
    w.history.back = () => { wentBack = true; };

    const evt = new w.Event('click', { bubbles: true, cancelable: true });
    w.document.getElementById('topBack').dispatchEvent(evt);

    assert.equal(evt.defaultPrevented, true, 'the default link navigation is prevented when we can go back instead');
    assert.equal(wentBack, true, 'history.back() is used so the homepage restores from bfcache');
  } finally { w.close(); }
});

test('vendor store: "Back to Marcato" falls back to the plain link for a direct/shared visit (no Marcato referrer)', async () => {
  const w = await bootStore(null);
  try {
    Object.defineProperty(w.document, 'referrer', { value: '', configurable: true });
    let wentBack = false;
    w.history.back = () => { wentBack = true; };

    const evt = new w.Event('click', { bubbles: true, cancelable: true });
    w.document.getElementById('topBack').dispatchEvent(evt);

    assert.equal(evt.defaultPrevented, false, 'no referrer means the plain href="/" link is left to work normally');
    assert.equal(wentBack, false);
  } finally { w.close(); }
});

test('index.html: the "from" back-link guard accepts a real store path and rejects an external URL', () => {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = /productBackTo = (\/\^[^;]+\/)\.test\(rawFrom\) \? rawFrom : null;/.exec(src);
  assert.ok(m, 'the from-param validation guard should be present in index.html');
  // eslint-disable-next-line no-eval -- evaluating the exact regex literal shipped in the page, not user input
  const guard = eval(m[1]);
  assert.equal(guard.test('/store/leather-co'), true, 'a real store path is accepted');
  assert.equal(guard.test('https://evil.com'), false, 'an absolute external URL must be rejected');
  assert.equal(guard.test('//evil.com'), false, 'a protocol-relative URL must be rejected');
});
