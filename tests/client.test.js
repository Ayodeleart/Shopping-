const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function boot(fetchImpl, extra) {
  const dom = new JSDOM('<!doctype html><body><div id="pAI"></div></body>', { url: 'https://shop.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = q => ({ matches: /reduce/.test(q) ? !!(extra && extra.reduced) : false, addListener() {}, addEventListener() {} });
  w.fetch = fetchImpl; w.AbortController = AbortController;
  w.eval(fs.readFileSync(path.join(__dirname, '../components/ai-assistant.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '../components/ai-product.js'), 'utf8'));
  return w;
}
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const mk = (w, o) => { const calls = []; const ai = new w.Pcx.Assistant(Object.assign({ getSession: () => null, getStoreName: () => 'Maccato', onBack: () => calls.push('back'), onNavigate: f => { calls.push('nav'); f(); }, openProduct: id => calls.push('open:' + id), addToCart: (id, q) => calls.push('cart:' + id + 'x' + q), openSignIn: () => calls.push('signin') }, o || {})); ai.calls = calls; return ai; };
const tick = () => new Promise(r => setTimeout(r, 15));

test('renderText escapes HTML and only allows bold/bullets', () => {
  const w = boot(() => json(200, {}));
  const html = w.Pcx.Assistant._renderText('<img src=x onerror=alert(1)> **hi**\n- one\n- two');
  assert.ok(!/<img/.test(html)); assert.match(html, /&lt;img/); assert.match(html, /<strong>hi<\/strong>/); assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
});

test('20/21 FAB is labelled + keyboard reachable; teaser can be dismissed and stays dismissed', () => {
  const w = boot(() => json(200, {}), { reduced: true });
  const ai = mk(w); ai.mountFab();
  const fab = w.document.querySelector('.ai-fab');
  assert.equal(fab.tagName, 'BUTTON'); assert.equal(fab.getAttribute('aria-label'), 'Open shopping assistant');
  assert.ok(!fab.classList.contains('pulse'));        // reduced motion: no pulse scheduled
  ai._dismissTeaser();
  assert.ok(w.localStorage.getItem('ai_teaser_off'));
  const ai2 = mk(w); assert.equal(ai2._teaserOk(), false);   // a later page load respects the dismissal
});

test('FAB hides when a page locks scrolling or a hash route is open', async () => {
  const w = boot(() => json(200, {}));
  const ai = mk(w); ai.mountFab();
  const fab = w.document.querySelector('.ai-fab');
  assert.equal(fab.hidden, false);
  w.document.body.style.overflow = 'hidden'; await tick();
  assert.equal(fab.hidden, true);
  w.document.body.style.overflow = ''; await tick();
  assert.equal(fab.hidden, false);
});

test('19 chat: first-time prompts, send, product cards from server, language auto-switch', async () => {
  let sent;
  const w = boot((url, opts) => { sent = JSON.parse(opts.body); return json(200, { reply: 'Here you go', language: 'pcm', state: { discussed: [{ id: 1, name: 'Phone' }] },
    cards: [{ kind: 'product', id: 1, name: 'Tecno <b>Phone</b>', price: 185000, availability: 'in_stock', image: null, reason: 'Good camera' }], actions: [] }); });
  const ai = mk(w); ai.open();
  const chips = [...w.document.querySelectorAll('.ai-chip')].map(c => c.textContent);
  assert.ok(chips.includes('Wetin you wan buy?') && chips.includes('Mo n wa ọja kan') && chips.includes('Compare two products'));
  ai._send('Abeg find phone'); await tick(); await tick();
  assert.equal(sent.language, 'en'); assert.equal(sent.messages.at(-1).content, 'Abeg find phone');
  assert.equal(ai.lang, 'pcm');                        // server-detected language switched (not locked)
  assert.equal(w.document.querySelector('.ai-lang').value, 'pcm');
  const card = w.document.querySelector('.ai-pc');
  assert.ok(card); assert.ok(!card.innerHTML.includes('<b>')); assert.match(card.textContent, /Tecno <b>Phone<\/b>/);   // shown as text, never as HTML
  card.querySelector('.ai-btn.pri').click();
  assert.deepEqual(ai.calls, ['nav', 'open:1']);
  assert.ok(JSON.parse(w.sessionStorage.getItem('ai_chat_v1')).msgs.length === 2);   // session persisted
});

test('manual language choice is locked and sent to the server', async () => {
  let sent; const w = boot((u, o) => { sent = JSON.parse(o.body); return json(200, { reply: 'ok', language: 'en', state: {}, cards: [], actions: [] }); });
  const ai = mk(w); ai.open();
  const sel = w.document.querySelector('.ai-lang'); sel.value = 'yo'; sel.dispatchEvent(new w.Event('change'));
  ai._send('hello'); await tick();
  assert.equal(sent.language, 'yo'); assert.equal(sent.languageLocked, true); assert.equal(ai.lang, 'yo');
});

test('22 multiple quick sends: only one request at a time', async () => {
  let n = 0; const w = boot(() => { n++; return new Promise(r => setTimeout(() => r({ ok: true, status: 200, json: async () => ({ reply: 'r', state: {}, cards: [], actions: [] }) }), 30)); });
  const ai = mk(w); ai.open();
  ai._send('one'); ai._send('two'); ai._send('three'); await new Promise(r => setTimeout(r, 80));
  assert.equal(n, 1); assert.equal(ai.msgs.filter(m => m.role === 'user').length, 1);
});

test('17 error state shows a safe message and Try again retries', async () => {
  let n = 0; const w = boot(() => (n++ ? json(200, { reply: 'back online', state: {}, cards: [], actions: [] }) : json(502, { error: 'The AI service had a problem. Please try again.' })));
  const ai = mk(w); ai.open(); ai._send('hi'); await tick(); await tick();
  assert.match(w.document.querySelector('.ai-bub.err').textContent, /AI service had a problem/);
  w.document.querySelector('.ai-retry').click(); await tick(); await tick();
  assert.match(w.document.querySelector('.ai-msgs').textContent, /back online/);
  assert.equal(w.document.querySelector('.ai-bub.err'), null);
});

test('network failure gives a friendly error, not a stack trace', async () => {
  const w = boot(() => Promise.reject(new Error('boom secret')));
  const ai = mk(w); ai.open(); ai._send('hi'); await tick(); await tick();
  const t = w.document.querySelector('.ai-bub.err').textContent; assert.match(t, /could not reach/i); assert.ok(!/boom/.test(t));
});

test('15/16 support ticket: shows summary, nothing sent until Submit; Cancel sends nothing', async () => {
  const urls = [];
  const w = boot((url, opts) => { urls.push(url); if (/ticket/.test(url)) return json(200, { ok: true, ticketId: 77 });
    return json(200, { reply: 'Should I submit it?', state: {}, cards: [], actions: [], ticket: { token: 'tok', preview: { category: 'order_issue', summary: 'Wrong item received', orderNumber: '1001', email: 'a@b.co' } } }); });
  const ai = mk(w); ai.open(); ai._send('send it'); await tick(); await tick();
  assert.match(w.document.querySelector('.ai-box').textContent, /Send this to support\?[\s\S]*Wrong item received/);
  assert.deepEqual(urls, ['/api/assistant']);                                  // no ticket call yet
  const [submit, cancel] = w.document.querySelectorAll('.ai-box .ai-btn');
  cancel.click();
  assert.deepEqual(urls, ['/api/assistant']); assert.match(w.document.querySelector('.ai-msgs').textContent, /not sent anything/);
  // second scenario: confirm
  ai.msgs = []; ai._render(); ai._send('again'); await tick(); await tick();
  w.document.querySelectorAll('.ai-box .ai-btn')[0].click(); await tick(); await tick();
  assert.ok(urls.includes('/api/assistant-ticket')); assert.match(w.document.querySelector('.ai-msgs').textContent, /reference is #77/);
});

test('add-to-cart action needs a tap; unsigned order lookup offers Sign in', async () => {
  const w = boot(() => json(200, { reply: 'Add it?', state: {}, cards: [], actions: [{ type: 'add_to_cart', id: 4, name: 'Nike Air', price: 45000, quantity: 2 }, { type: 'sign_in' }] }));
  const ai = mk(w); ai.open(); ai._send('add nike'); await tick(); await tick();
  assert.deepEqual(ai.calls, []);                                             // nothing happened yet
  w.document.querySelector('.ai-box .ai-btn.pri').click();
  assert.deepEqual(ai.calls, ['cart:4x2']);
  [...w.document.querySelectorAll('.ai-btn.pri')].find(b => b.textContent === 'Sign in').click();
  assert.ok(ai.calls.includes('signin'));
});

test('close/back + reset need a second tap', async () => {
  const w = boot(() => json(200, { reply: 'x', state: {}, cards: [], actions: [] }));
  const ai = mk(w); ai.open(); ai._send('hi'); await tick(); await tick();
  w.document.querySelector('.ai-hdr .ai-hbtn').click(); assert.deepEqual(ai.calls, ['back']);
  const reset = w.document.querySelectorAll('.ai-hdr .ai-hbtn')[1];
  reset.click(); assert.equal(ai.msgs.length, 2); reset.click(); assert.equal(ai.msgs.length, 0);
});

/* ---- AI product panel ---- */
test('1-5 product panel: draft banner, edits kept, apply fills the form, reject clears; nothing saved by itself', async () => {
  const draft = { title: 'Red Bag', shortDescription: 'Short', description: 'Long', highlights: ['Red'], category: 'Bags', tags: ['bag', 'red'], attributes: { Colour: 'Red' }, detectedText: ['ZARA'], altText: 'A red bag', missingInformation: ['Material'], warnings: ['"waterproof" ...'], confidence: 'medium' };
  let body; const w = boot((u, o) => { body = JSON.parse(o.body); return json(200, { draft, categoryId: 12 }); });
  const applied = {};
  const picker = { getSources: () => [] };
  const ai = new w.Pcx.AIProduct(w.document.getElementById('pAI'), { endpoint: '/api/ai-product', getToken: async () => 'tok', getPicker: () => picker,
    getInput: () => ({ name: 'Bag', price: '15000' }), apply: { title: v => { applied.title = v; }, description: v => { applied.desc = v; }, categoryId: v => { applied.cat = v; } } });
  await ai._generate(); 
  assert.match(w.document.body.textContent, /AI-generated draft — please review before publishing\./);
  assert.match(w.document.body.textContent, /Material/); assert.match(w.document.body.textContent, /ZARA/); assert.match(w.document.body.textContent, /waterproof/);
  assert.equal(body.name, 'Bag'); assert.deepEqual(body.images, []);
  const title = w.document.querySelector('input[aria-label="Title"]'); title.value = 'My own title';
  [...w.document.querySelectorAll('.aip-btn')].find(b => b.textContent === 'Apply to form').click();
  assert.equal(applied.title, 'My own title'); assert.equal(applied.desc, 'Long'); assert.equal(applied.cat, 12);
  assert.equal(JSON.stringify(ai.extras()), JSON.stringify({ ai_assisted: true, tags: ['bag', 'red'], image_alt: 'A red bag' }));
  [...w.document.querySelectorAll('.aip-btn')].find(b => b.textContent === 'Reject draft').click();
  assert.equal(ai.draft, null); assert.equal(w.document.querySelector('.aip-banner'), null);
});
test('product panel: regenerate one field sends fields + the current edits; errors are shown, name/photo required', async () => {
  let body; const w = boot((u, o) => { body = JSON.parse(o.body); return json(200, { draft: { title: 'A', shortDescription: '', description: '', highlights: [], category: '', tags: ['new'], attributes: {}, detectedText: [], altText: '', missingInformation: [], warnings: [], confidence: 'low' }, categoryId: null }); });
  const ai = new w.Pcx.AIProduct(w.document.getElementById('pAI'), { getToken: async () => 'tok', getPicker: () => ({ getSources: () => [] }), getInput: () => ({ name: '' }), apply: {} });
  await ai._generate(); assert.match(w.document.body.textContent, /Enter a product name or add a photo/); assert.equal(body, undefined);
  ai.o.getInput = () => ({ name: 'Bag' }); await ai._generate();
  w.document.querySelector('input[aria-label="Title"]').value = 'Edited';
  await ai._generate(['tags']);
  assert.equal(JSON.stringify(body.fields), '["tags"]'); assert.equal(body.previous.title, 'Edited');
  ai.o.getToken = async () => null; await ai._generate(); assert.match(w.document.body.textContent, /sign in again/i);
});
