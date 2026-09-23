const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function boot(fetchImpl, extra) {
  const dom = new JSDOM('<!doctype html><body></body></html>', { url: 'https://shop.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = q => ({ matches: /reduce/.test(q) ? !!(extra && extra.reduced) : false, addListener() {}, addEventListener() {} });
  w.fetch = fetchImpl || (() => Promise.resolve({ ok: true, status: 200, json: async () => ({ reply: 'ok', state: {}, cards: [], actions: [] }) }));
  w.AbortController = AbortController;
  w.MAC_FAB_MANUAL = true; w.MAC_CHAT_MANUAL = true;
  w.eval(fs.readFileSync(path.join(__dirname, '../components/mac-theme.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '../components/mac-chat.js'), 'utf8'));
  return w;
}
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const mk = (w, o) => new w.Pcx.MacChat(Object.assign({ getSession: () => null, getStoreName: () => 'Maccato', openProduct: () => {}, openOrder: () => {}, openSignIn: () => {}, addToCart: () => {} }, o || {}));
const tick = () => new Promise(r => setTimeout(r, 15));

/* ---------------- mac-theme.js ---------------- */
test('mac-theme: default preset leaves the store colour untouched', () => {
  const w = boot();
  assert.equal(w.document.documentElement.style.getPropertyValue('--mac-accent-user'), '');
  assert.equal(w.document.documentElement.classList.contains('mac-pride'), false);
});
test('mac-theme: choosing a colour sets --mac-accent-user and persists across a reload', () => {
  const w = boot();
  w.Pcx.macTheme.set('yellow');
  assert.equal(w.document.documentElement.style.getPropertyValue('--mac-accent-user'), '#F5B301');
  assert.equal(w.localStorage.getItem('mac_accent_pref'), 'yellow');
  assert.equal(w.Pcx.macTheme.get(), 'yellow');
});
test('mac-theme: Pride toggles a class and injects a reusable gradient definition, clearing the plain accent var', () => {
  const w = boot();
  w.Pcx.macTheme.set('yellow');
  w.Pcx.macTheme.set('pride');
  assert.equal(w.document.documentElement.classList.contains('mac-pride'), true);
  assert.equal(w.document.documentElement.style.getPropertyValue('--mac-accent-user'), '');
  assert.ok(w.document.getElementById('mac-pride-grad'));
  w.Pcx.macTheme.set('default');
  assert.equal(w.document.documentElement.classList.contains('mac-pride'), false);
});
test('mac-theme: an unknown id falls back to default rather than applying garbage', () => {
  const w = boot();
  w.Pcx.macTheme.set('neon-plaid');
  assert.equal(w.Pcx.macTheme.get(), 'default');
  assert.equal(w.document.documentElement.style.getPropertyValue('--mac-accent-user'), '');
});

/* ---------------- header layout ---------------- */
test('header shows exactly reload, settings, close \u2014 in that order \u2014 and nothing else', () => {
  const w = boot(); const chat = mk(w); chat.open();
  const order = [...w.document.querySelectorAll('.macChat-head .macChat-ib')].map(b => b.getAttribute('data-act'));
  assert.deepEqual(order, ['new', 'settings', 'close']);
});

/* ---------------- settings screen open/close ---------------- */
test('opening settings adds one overlay class and marks the chat underneath inert; back removes both', () => {
  const w = boot(); const chat = mk(w); chat.open();
  w.document.querySelector('[data-act="settings"]').click();
  assert.equal(chat.panel.classList.contains('settingsOpen'), true);
  assert.equal(chat.head.hasAttribute('inert'), true);
  assert.equal(chat.log.hasAttribute('inert'), true);
  assert.equal(chat.form.hasAttribute('inert'), true);
  // exactly one settings overlay, with its own header \u2014 not a second copy of the chat header
  assert.equal(w.document.querySelectorAll('.macChat-settings').length, 1);
  assert.equal(w.document.querySelectorAll('.macChat-head').length, 1);
  assert.equal(w.document.querySelector('.macChat-settings-head b').textContent, 'Settings');
  w.document.querySelector('[data-act="back"]').click();
  assert.equal(chat.panel.classList.contains('settingsOpen'), false);
  assert.equal(chat.head.hasAttribute('inert'), false);
});
test('close (X) works from inside settings too, and there is only ever one close button visible in the DOM tree it lives in', () => {
  const w = boot(); const chat = mk(w); chat.open();
  w.document.querySelector('[data-act="settings"]').click();
  const closes = [...w.document.querySelectorAll('[data-act="close"]')];
  assert.equal(closes.length, 3);          // the scrim, the (now-inert) chat header, and the settings overlay
  const btnCloses = closes.filter(n => n.tagName === 'BUTTON');
  assert.equal(btnCloses.length, 2);
  assert.equal(chat.head.contains(btnCloses[0]), true);
  assert.equal(chat.settingsPanel.contains(btnCloses[1]), true);
  btnCloses[1].click();
  assert.equal(chat.isOpen, false);
});
test('settings lists all five languages and the colour swatches, including Pride', () => {
  const w = boot(); const chat = mk(w); chat.open();
  w.document.querySelector('[data-act="settings"]').click();
  const langs = [...w.document.querySelectorAll('.macSet-lang span:first-child')].map(s => s.textContent);
  assert.deepEqual(langs, ['English', 'Nigerian Pidgin', 'Yoruba', 'Igbo', 'Hausa']);
  assert.equal(w.document.querySelector('.macSet-lang.on span:first-child').textContent, 'English');
  const swatchIds = [...w.document.querySelectorAll('.macSet-swatch')].map(b => b.getAttribute('data-color'));
  assert.deepEqual(swatchIds, ['default', 'yellow', 'green', 'blue', 'purple', 'pink', 'pride']);
  assert.ok(w.document.querySelector('.macSet-swatch.pride'));
});
test('picking a colour in settings updates the selection ring and MAC\u2019s accent', () => {
  const w = boot(); const chat = mk(w); chat.open();
  w.document.querySelector('[data-act="settings"]').click();
  w.document.querySelector('.macSet-swatch[data-color="green"]').click();
  assert.equal(w.document.documentElement.style.getPropertyValue('--mac-accent-user'), '#1DA34C');
  assert.ok(w.document.querySelector('.macSet-swatch[data-color="green"]').classList.contains('on'));
  assert.equal(w.document.querySelector('.macSet-swatch[data-color="default"]').classList.contains('on'), false);
});

/* ---------------- full-page localisation, not just the greeting ---------------- */
test('choosing Nigerian Pidgin changes placeholder, disclaimer, chips and button labels together', async () => {
  const w = boot(); const chat = mk(w); chat.open();
  w.document.querySelector('[data-act="settings"]').click();
  w.document.querySelector('.macSet-lang[data-lang="pcm"]').click();
  assert.equal(chat.lang, 'pcm');
  assert.equal(JSON.parse(w.localStorage.getItem('ai_lang_pref')), 'pcm');
  w.document.querySelector('[data-act="back"]').click();
  assert.equal(w.document.querySelector('.macChat-input').placeholder, 'Ask MAC anytin');
  assert.equal(w.document.querySelector('.macChat-note').textContent, 'MAC fit make mistake sometimes. Check the product page well well before you buy.');
  const chips = [...w.document.querySelectorAll('.macChat-chip')].map(c => c.textContent);
  assert.ok(chips.includes('Find something wey no pass \u20a650,000'));
  assert.equal(w.document.querySelector('[data-act="new"]').getAttribute('aria-label'), 'Start new chat');
});
test('choosing Yoruba localises product-card and add-to-cart button labels for both past and future messages', async () => {
  const w = boot(() => json(200, { reply: 'ok', state: {}, cards: [{ kind: 'product', id: 1, name: 'Phone', price: 10000, availability: 'in_stock' }], actions: [{ type: 'sign_in' }] }));
  const chat = mk(w); chat.open();
  chat.ask('hi'); await tick(); await tick();
  w.document.querySelector('[data-act="settings"]').click();
  w.document.querySelector('.macSet-lang[data-lang="yo"]').click();
  w.document.querySelector('[data-act="back"]').click();
  assert.equal(w.document.querySelector('.mcBtn.pri').textContent, 'Wo ọjà náà');       // "View product", relabelled on an already-rendered card
  assert.equal(w.document.querySelector('.mcPa').textContent, 'Ó wà');                  // "In stock"
  assert.equal([...w.document.querySelectorAll('.mcBtn.pri')].find(b => /^W\u1ecdl\u00e9/.test(b.textContent)).textContent, 'Wọlé'); // "Sign in"
});
test('server-detected language (not locked) still re-localises the whole panel', async () => {
  const w = boot(() => json(200, { reply: 'ok', language: 'ha', state: {}, cards: [], actions: [] }));
  const chat = mk(w); chat.open();
  chat.ask('Ina neman waya'); await tick(); await tick();
  assert.equal(chat.lang, 'ha'); assert.equal(chat.locked, false);
  assert.equal(w.document.querySelector('.macChat-input').placeholder, 'Tambayi MAC kowane abu');
});
test('network and server errors are shown in the currently selected language', async () => {
  let fail = true;
  const w = boot(() => fail ? Promise.reject(new Error('boom')) : json(200, { reply: 'back', state: {}, cards: [], actions: [] }));
  const chat = mk(w); chat.open();
  w.document.querySelector('[data-act="settings"]').click();
  w.document.querySelector('.macSet-lang[data-lang="ig"]').click();
  w.document.querySelector('[data-act="back"]').click();
  chat.ask('hi'); await tick(); await tick();
  assert.equal(w.document.querySelector('.macChat-msg.err').textContent, 'Enweghị m ike iru MAC. Lelee netwọk gị ma nwaa ọzọ.');
  fail = false;
  w.document.querySelector('.macChat-retry').click(); await tick(); await tick();
  assert.match(w.document.querySelector('.macChat-log').textContent, /back/);
});
test('support-ticket dialog and outgoing request both use the locked language', async () => {
  let seen;
  const w2 = boot((url, opts) => { seen = JSON.parse(opts.body); return json(200, { reply: 'ok', state: {}, cards: [], actions: [], ticket: { token: 'tok', preview: { category: 'order_issue', summary: 'Wrong item' } } }); });
  const chat = mk(w2); chat.open();
  w2.document.querySelector('[data-act="settings"]').click();
  w2.document.querySelector('.macSet-lang[data-lang="ha"]').click();
  w2.document.querySelector('[data-act="back"]').click();
  chat.ask('send it'); await tick(); await tick();
  assert.equal(seen.language, 'ha'); assert.equal(seen.languageLocked, true);
  assert.match(w2.document.querySelector('.mcBox').textContent, /In aika wannan zuwa ga tallafi\?/);
  assert.equal([...w2.document.querySelectorAll('.mcBtn.pri')].find(b => /Aika/.test(b.textContent)).textContent, 'Aika zuwa ga tallafi');
});

/* ---------------- reset / close still work with the new header ---------------- */
test('reset needs a second tap and re-renders in the current language; close works from settings too', async () => {
  const w = boot(() => json(200, { reply: 'x', state: {}, cards: [], actions: [] }));
  const chat = mk(w); chat.open();
  chat.ask('hi'); await tick(); await tick();
  w.document.querySelector('[data-act="new"]').click();
  assert.equal(chat.msgs.length, 2);
  w.document.querySelector('[data-act="new"]').click();
  assert.equal(chat.msgs.length, 0);
  w.document.querySelector('[data-act="settings"]').click();
  w.document.querySelector('[data-act="close"]').click();
  assert.equal(chat.isOpen, false);
});

/* ---------------- CSS regression guards ---------------- */
test('regression: no rule sets display on .macChat-head* siblings without scoping to a state class (the exact bug that showed two headers at once)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../components/mac-chat.css'), 'utf8');
  const bad = /\.macChat-headChat[\s,]|\.macChat-headSettings[\s,{.]/;
  assert.equal(bad.test(css), false, 'the old dual-header classes should be gone entirely, not just relabelled');
  assert.match(css, /\.macChat-settings\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.macChat-panel\.settingsOpen \.macChat-settings\s*\{[^}]*display:\s*flex/);
});
test('regression: MAC\u2019s accent colour is applied to the FAB unconditionally, not only during the .isJoy bounce', () => {
  const css = fs.readFileSync(path.join(__dirname, '../components/mac-fab.css'), 'utf8');
  assert.match(css, /\.macFab \.macBall\s*\{[^}]*fill:\s*var\(--mac-accent\)/);
  assert.doesNotMatch(css, /\.macFab\.isJoy \.macBall\s*\{[^}]*fill:\s*var\(--mac-accent\)/);
});
