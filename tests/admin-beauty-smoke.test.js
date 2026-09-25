/* Integration smoke: boot the REAL admin/index.html in jsdom (local scripts from
   disk) with an in-memory Supabase stub + admin session, and verify the Beauty
   admin pane (Background / Hero slides / Categories CRUD module) is wired in. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

function makeClient() {
  const tables = {};
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
      ilike(c, v) { rows = rows.filter(r => String(r[c] == null ? '' : r[c]).toLowerCase().includes(String(v).replace(/%/g, '').toLowerCase())); return q; },
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
  const session = { user: { id: 'admin-user-1', email: 'ayodeleart1@gmail.com' }, access_token: 'stub-token' };
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
    storage: {
      from: () => ({
        list: async () => ({ data: [] }),
        upload: async (p, buf) => ({ data: { path: p }, error: null }),
        getPublicUrl: p => ({ data: { publicUrl: 'https://x/' + p } })
      })
    },
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
  };
}

class LocalOnlyLoader extends ResourceLoader {
  fetch(url, options) {
    if (url.startsWith('https://admin.test/')) {
      const p = path.join(ROOT, new URL(url).pathname);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
      return Promise.reject(new Error('not found ' + p));
    }
    return Promise.reject(new Error('no network in admin smoke: ' + url));
  }
}

test('real admin/index.html: Beauty sub-tab and pane boot, CRUD module loads', async () => {
  const htmlPath = path.join(ROOT, 'admin', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8')
    .replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '');
  const url = 'https://admin.test/admin/index.html';
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = String((e && e.message) || e);
    if (!/no network|not found \/home|Could not load|Could not parse CSS|admin smoke/i.test(m)) errors.push(m.split('\n')[0]);
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
      win.fetch = async () => { throw new Error('no network in admin smoke'); };
    }
  });
  w = dom.window;

  try {
    await new Promise(res => setTimeout(res, 1800));
    const $ = s => w.document.querySelector(s);

    assert.ok($('#app').classList.contains('on'), 'admin dashboard unlocked for the admin session');
    assert.ok($('#loginWrap').style.display === 'none', 'login screen hidden');

    /* Beauty lives in the Explore tab (Worlds / Fashion / Beauty), alongside every other Explore Marcato admin screen */
    const tabs = [...w.document.querySelectorAll('[data-esub]')].map(t => t.getAttribute('data-esub'));
    assert.ok(tabs.includes('beauty'), 'Beauty sub-tab present under Explore');
    assert.equal($('[data-tab="explore"]').getAttribute('aria-label'), 'Explore');
    assert.ok(!w.document.querySelector('[data-tab="fashion"]'), 'the old standalone Fashion tab is gone');

    assert.ok(typeof w.BeautyAdmin === 'object' && typeof w.BeautyAdmin.open === 'function', 'BeautyAdmin module loaded');
    assert.ok($('#beautyPane'), 'beauty pane in the DOM');

    /* switching to the sub-tab opens the pane and the module renders its cards */
    w.switchExploreSub('beauty');
    await new Promise(res => setTimeout(res, 200));
    assert.ok($('#beautyPane').style.display !== 'none', 'beauty pane visible after switching');
    assert.ok($('#bwBgFile'), 'background upload input rendered');
    assert.ok(w.document.querySelector('[data-a="bg-upload"]'), 'background upload/replace button');
    assert.ok(w.document.querySelector('[data-a="hero-new"]'), 'hero section rendered with + New Slide');
    assert.ok(w.document.querySelector('[data-a="cat-new"]'), 'categories section rendered with + New Category');

    /* open the hero form through the real admin module */
    w.document.querySelector('[data-a="hero-new"]').click();
    await new Promise(res => setTimeout(res, 80));
    assert.ok($('#bwForm'), 'hero form rendered');
    assert.ok(w.document.querySelector('[data-f="title"]'), 'title field');
    assert.ok(w.document.querySelector('[data-pk]'), 'image picker mounted');
    const title = w.document.querySelector('[data-f="title"]');
    title.value = 'Smoke Test Slide';
    title.dispatchEvent(new w.Event('input', { bubbles: true }));
    /* save without an image: the module must validate and complain, not crash */
    w.document.querySelector('[data-a="save"]').click();
    await new Promise(res => setTimeout(res, 80));
    assert.ok($('#bwForm'), 'still in the form after rejected save (validation)');

    /* cancel back to the list */
    w.document.querySelector('[data-a="cancel"]').click();
    await new Promise(res => setTimeout(res, 80));
    assert.ok(!$('#bwForm'), 'back to the list after cancel');

    /* new category tile: name + slugify through the real module, persisted to the stub table */
    w.document.querySelector('[data-a="cat-new"]').click();
    await new Promise(res => setTimeout(res, 80));
    const name = w.document.querySelector('[data-f="name"]');
    name.value = "Men's Grooming";
    name.dispatchEvent(new w.Event('input', { bubbles: true }));
    w.document.querySelector('[data-a="save"]').click();
    await new Promise(res => setTimeout(res, 150));
    assert.ok(!$('#bwForm'), 'category form closed after save');
    assert.ok(w.document.querySelector('[data-a="cat-toggle"]'), 'saved tile rendered with actions');
  } finally {
    if (w) w.close();
  }

  const fatal = errors.filter(m => !/no network|admin smoke/i.test(m));
  assert.equal(fatal.length, 0, 'no unexpected errors: ' + fatal.slice(0, 5).join(' | '));
});
