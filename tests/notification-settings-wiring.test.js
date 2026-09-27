/* Regression test for a real bug: index.html wired the notification-center opener into
 * Pcx.Profile.init() under the key `openNotifCenter`, but components/profile-page.js reads
 * `D.openNotifPrefs`. Because the mismatch meant D.openNotifPrefs was undefined, tapping
 * "Notifications" in the account sheet ran close() (revealing the homepage underneath) and
 * then silently did nothing — which read as "Notifications sends me back to the homepage."
 *
 * This test loads the REAL components/profile-page.js (and its data/buyer.js dependency) into
 * jsdom, wires it exactly like index.html should, and asserts that tapping the notify action
 * actually invokes the opener — so a future rename can't reintroduce the same mismatch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');

/* Minimal fake Supabase: only what Buyer.profile/counts/orderCounts touch during Pcx.Profile.open(). */
function fakeSb() {
  return {
    from(table) {
      const q = {
        _opts: {},
        select(_cols, opts) { q._opts = opts || {}; return q; },
        eq() { return q; },
        is() { return q; },
        order() { return q; },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); },
        then(res, rej) {
          return Promise.resolve({ data: [], error: null, count: q._opts.count ? 0 : undefined }).then(res, rej);
        }
      };
      return q;
    }
  };
}

function boot() {
  const dom = new JSDOM('<!doctype html><body><div id="profPage"></div></body></html>', {
    url: 'https://shop.test/', runScripts: 'outside-only'
  });
  const w = dom.window;
  w.eval(fs.readFileSync(path.join(ROOT, 'data/buyer.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'components/profile-page.js'), 'utf8'));
  return w;
}

test('notify wiring: index.html passes the notification opener under the exact key profile-page.js reads', () => {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = /Pcx\.Profile\.init\(\{([\s\S]*?)\}\);/.exec(src);
  assert.ok(m, 'Pcx.Profile.init({...}) call not found in index.html');
  const initArgs = m[1];
  assert.match(initArgs, /openNotifPrefs\s*:/, 'index.html must wire openNotifPrefs — profile-page.js does not read openNotifCenter');
});

test('tapping the account "notify" action calls the opener the page wired in (not a dead property)', async () => {
  const w = boot();
  const session = { user: { id: 'buyer-1', email: 'a@b.com' } };
  let openedNotifPrefs = 0;
  w.Pcx.Profile.init({
    sb: fakeSb(), session: () => session, fmt: n => '₦' + n, toast: () => {},
    signOut: () => {}, openNotifPrefs: () => { openedNotifPrefs++; }, openLegal: () => {},
    openWishlist: () => {}, openHistory: () => {}, openSupport: () => {}
  });

  const opened = await w.Pcx.Profile.open();
  assert.equal(opened, true, 'profile sheet should open for a signed-in session');

  const root = w.document.getElementById('profPage');
  const notifyBtn = root.querySelector('[data-a="notify"]');
  assert.ok(notifyBtn, 'a [data-a="notify"] control should exist in the account sheet');

  notifyBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 0));

  assert.equal(openedNotifPrefs, 1, 'clicking Notifications must call the wired opener exactly once');
  assert.equal(root.classList.contains('open'), false, 'the profile sheet closes when handing off to notifications (this is expected, not the bug)');
});
