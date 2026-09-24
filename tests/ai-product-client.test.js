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
  w.eval(fs.readFileSync(path.join(__dirname, '../components/ai-product.js'), 'utf8'));
  return w;
}
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });

/* ---- AI product panel (vendor/admin "Generate with AI") ---- */
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
