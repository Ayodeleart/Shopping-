const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeSb } = require('./fakesb');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 15; i++) await tick(); }
const windows = [];
test.after(() => windows.forEach(w => w.close()));

const OLD = n => 'https://cdn.test/storage/v1/object/public/avatars/categories/old-' + n + '.png';
function seed() {
  const c = (id, parent, slug, name, so, img) => ({ id, parent_id: parent, slug, name, sort_order: so, is_active: true, image_url: img || null, gif_url: 'https://cdn.test/g' + id + '.gif' });
  return { categories: [
    c(1, null, 'fashion', 'Fashion', 10, OLD('fashion')),
    c(2, null, 'food', 'Food', 20, null),
    c(3, null, 'beauty', 'Beauty', 30, OLD('beauty')),
    c(11, 1, 'shoes', 'Shoes', 10, null),
    c(12, 1, 'bags', 'Bags', 20, OLD('bags')),
    c(21, 2, 'rice', 'Rice dishes', 10, null),
    c(22, 2, 'swallow', 'Swallow', 20, null),
    c(211, 21, 'jollof', 'Jollof', 10, null)
  ], products: [] };
}

async function boot(o) {
  o = o || {};
  const dom = new JSDOM('<!doctype html><body><div id="catAdmin"></div></body>', { url: 'https://shop.test/admin/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; windows.push(w);
  const sb = makeSb(o.seed || seed(), { isAdmin: o.isAdmin !== false });
  const log = { toasts: [], uploads: [], confirms: [] };
  // failure injection: fail an upload by file name, or the category update for an id
  const failUpload = o.failUpload || new Set(), failUpdate = o.failUpdate || new Set();
  const realFrom = sb.from;
  sb.from = t => {
    const q = realFrom(t);
    if (t !== 'categories') return q;
    const realUpdate = q.update; let uid = null;
    q.update = p => { const u = realUpdate(p); const realEq = u.eq; u.eq = (c, v) => { uid = v; return realEq(c, v); };
      const realThen = u.then; u.then = (a, b) => {
        if (failUpdate.has(uid)) return Promise.resolve({ data: null, error: { message: 'network down' } }).then(a, b);
        return realThen.call(u, a, b); };
      return u; };
    return q;
  };
  w.sb = sb; w.BUCKET = 'avatars';
  w.toast = (m, err) => log.toasts.push({ m, err: !!err });
  w.confirm = (t, m, cb) => { log.confirms.push({ t, m }); if (o.confirmYes !== false) cb(); };
  w.showLoad = () => {}; w.hideLoad = () => {};
  let blob = 0;
  w.URL.createObjectURL = () => 'blob:test/' + (++blob); w.URL.revokeObjectURL = () => {};
  w.Element.prototype.scrollIntoView = function () {};
  w.uploadImage = async (file, folder) => {
    log.uploads.push(file.name);
    if (failUpload.has(file.name)) throw new Error('Upload blocked');
    return 'https://cdn.test/storage/v1/object/public/avatars/' + folder + '/' + Date.now() + '_' + log.uploads.length + '_' + file.name;
  };
  ['data/safe.js', 'data/categories.js', 'components/category-picker.js', 'admin/category-images.js', 'admin/categories.js'].forEach(f => w.eval(read(f)));
  await w.CatAdmin.load(); await settle();
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const ui = {
    w, sb, db: sb._db, log, $, $$, failUpload, failUpdate,
    img: id => (ui.db.tables.categories.find(r => r.id === id) || {}).image_url,
    async click(el) { (typeof el === 'string' ? $(el) : el).click(); await settle(); },
    file: (name, type) => new w.File([new Uint8Array(10)], name, { type: type || 'image/png' }),
    item: id => $('[data-item="' + id + '"]'),
    async pick(id, file) {
      const input = $('[data-cim-file="' + id + '"]');
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
    },
    async open() { await ui.click('[data-act="bulkimg"]'); },
    async tab(scope) { await ui.click('[data-cim="tab"][data-scope="' + scope + '"]'); },
    save: () => ui.click('[data-cim="save"]')
  };
  return ui;
}

test('lists every category with its own image control, subcategories grouped under their parent', async () => {
  const ui = await boot(); await ui.open();
  assert.deepEqual(ui.$$('[data-item] .cim-name').map(e => e.textContent), ['Fashion', 'Food', 'Beauty']);
  assert.equal(ui.$$('[data-cim-file]').length, 3);
  await ui.tab('subs');
  const kids = ui.$$('#cimList > *').map(e => e.classList.contains('cim-group') ? 'G:' + e.querySelector('span').textContent : e.querySelector('.cim-name').textContent);
  assert.deepEqual(kids, ['G:Fashion', 'Shoes', 'Bags', 'G:Food', 'Rice dishes', 'Jollof', 'Swallow']);
  assert.equal(ui.$$('[data-cim-file]').length, 5);
});

test('different images for several categories and subcategories in one batch: nothing uploads until Save, then each lands on its own item', async () => {
  const ui = await boot(); await ui.open();
  await ui.pick(1, ui.file('fashion-new.png')); await ui.pick(2, ui.file('food-new.png'));     // Beauty is left alone
  await ui.tab('subs');
  await ui.pick(11, ui.file('shoes-new.png')); await ui.pick(22, ui.file('swallow-new.png')); await ui.pick(211, ui.file('jollof-new.png'));
  assert.deepEqual(ui.log.uploads, [], 'no upload before Save All Changes');
  assert.equal(ui.img(1), OLD('fashion'), 'database untouched while pending');
  assert.equal(ui.$('.cim-count b').textContent, '3');
  assert.match(ui.$('.cim-tabs').textContent, /2/);                                        // the other tab shows its 2 pending

  await ui.save();                                                                          // saves the subcategory list only
  assert.deepEqual([...ui.log.uploads].sort(), ['jollof-new.png', 'shoes-new.png', 'swallow-new.png']);
  assert.match(ui.img(11), /shoes-new\.png$/); assert.match(ui.img(22), /swallow-new\.png$/); assert.match(ui.img(211), /jollof-new\.png$/);
  assert.equal(ui.img(1), OLD('fashion'), 'the categories list was not saved yet');
  assert.equal(ui.img(21), null, 'an untouched sibling stays as it was');
  assert.equal(ui.img(12), OLD('bags'), 'an untouched image is preserved');

  await ui.tab('cats'); await ui.save();
  assert.match(ui.img(1), /fashion-new\.png$/); assert.match(ui.img(2), /food-new\.png$/);
  assert.equal(ui.img(3), OLD('beauty'), 'Beauty was never touched');
  const urls = [1, 2, 11, 22, 211].map(ui.img); assert.equal(new Set(urls).size, 5, 'every item got a different, collision-free url');
  assert.equal(ui.log.toasts.filter(t => t.err).length, 0);
  // the gif column is not touched by the image editor
  assert.equal(ui.db.tables.categories.find(r => r.id === 1).gif_url, 'https://cdn.test/g1.gif');
});

test('choosing an image for one item never changes another item\'s pending image', async () => {
  const ui = await boot(); await ui.open();
  await ui.pick(1, ui.file('a.png')); await ui.pick(2, ui.file('b.png'));
  await ui.pick(1, ui.file('a2.png'));                                                      // replace A again
  await ui.save();
  assert.match(ui.img(1), /a2\.png$/); assert.match(ui.img(2), /b\.png$/);
  assert.deepEqual([...ui.log.uploads].sort(), ['a2.png', 'b.png']);
});

test('after saving, a fresh load from the database shows each image on the right item', async () => {
  const ui = await boot(); await ui.open();
  await ui.pick(1, ui.file('one.png')); await ui.pick(3, ui.file('three.png')); await ui.save();
  await ui.w.CatAdmin.load(); await settle();
  const t = ui.w.CatAdmin.tree();
  assert.match(t.byId[1].imageUrl, /one\.png$/); assert.match(t.byId[3].imageUrl, /three\.png$/); assert.equal(t.byId[2].imageUrl, '');
});

test('a failed upload keeps the old image and the chosen file, the others still save, and retry works without re-uploading successes', async () => {
  const ui = await boot(); await ui.open();
  await ui.pick(1, ui.file('good.png')); await ui.pick(3, ui.file('bad.png')); await ui.pick(2, ui.file('ok.png'));
  ui.failUpload.add('bad.png');
  await ui.save();
  assert.match(ui.img(1), /good\.png$/); assert.match(ui.img(2), /ok\.png$/);
  assert.equal(ui.img(3), OLD('beauty'), 'existing image not cleared by the failure');
  assert.ok(ui.item(3).classList.contains('failed'), 'the failed item is marked');
  assert.match(ui.item(3).textContent, /Upload blocked/);
  assert.equal(ui.$('.cim-count b').textContent, '1', 'only the failed one is still pending');
  assert.match(ui.$('#cimSummary').textContent, /2 saved, 1 failed/);
  assert.ok(ui.log.toasts.some(t => t.err && /1 failed/.test(t.m)), 'no success toast for a partial failure');

  ui.failUpload.clear(); ui.log.uploads.length = 0;
  await ui.save();
  assert.deepEqual(ui.log.uploads, ['bad.png'], 'retry uploads only what failed');
  assert.match(ui.img(3), /bad\.png$/);
  assert.equal(ui.$('.cim-count b').textContent, '0');
});

test('an upload that worked but whose database update failed is not uploaded twice on retry, and nothing is reported as saved', async () => {
  const ui = await boot(); await ui.open();
  await ui.pick(2, ui.file('food.png')); ui.failUpdate.add(2);
  await ui.save();
  assert.equal(ui.img(2), null);
  assert.ok(ui.item(2).classList.contains('failed'));
  assert.match(ui.item(2).textContent, /uploaded but not saved yet/);
  assert.ok(!ui.log.toasts.some(t => !t.err && /saved/.test(t.m)), 'no success message');
  ui.failUpdate.clear(); await ui.save();
  assert.equal(ui.log.uploads.filter(n => n === 'food.png').length, 1);
  assert.match(ui.img(2), /food\.png$/);
});

test('a policy-denied write surfaces as a per-item failure without clearing the image', async () => {
  const denied = await boot({ isAdmin: false }); await denied.open();
  await denied.pick(2, denied.file('x.png')); await denied.save();
  assert.ok(denied.item(2).classList.contains('failed'), 'not-admin: policy error surfaces per item');
  assert.equal(denied.img(2), null);
  assert.match(denied.item(2).textContent, /Not allowed/);
});

test('Remove clears only that item, Undo drops a pending change, unchanged images are preserved', async () => {
  const ui = await boot(); await ui.open();
  await ui.click('[data-item="1"] [data-cim="rm"]');
  await ui.pick(2, ui.file('f.png')); await ui.click('[data-item="2"] [data-cim="undo"]');
  assert.equal(ui.$('.cim-count b').textContent, '1');
  assert.equal(ui.$('[data-item="2"] [data-cim="rm"]'), null, 'nothing to remove on an item without an image');
  await ui.save();
  assert.equal(ui.img(1), null); assert.equal(ui.img(3), OLD('beauty')); assert.equal(ui.img(2), null);
  assert.deepEqual(ui.log.uploads, []);
});

test('pending changes are protected: back asks first, tab guard asks, browser leave prompt is armed', async () => {
  const ui = await boot({ confirmYes: false }); await ui.open();
  const ev = () => { const e = new ui.w.Event('beforeunload', { cancelable: true }); ui.w.dispatchEvent(e); return e.defaultPrevented; };
  assert.equal(ev(), false, 'nothing pending: no prompt');
  await ui.pick(1, ui.file('a.png'));
  assert.equal(ev(), true, 'pending: browser asks before leaving');
  await ui.click('[data-cim="back"]');
  assert.equal(ui.log.confirms.length, 1); assert.ok(ui.w.CatImages.isOpen(), 'stays open until confirmed');
  let left = false; ui.w.CatImages.guard(() => { left = true; });
  assert.equal(left, false); assert.equal(ui.log.confirms.length, 2);
  await ui.click('[data-cim="discard"]');
  assert.equal(ui.w.CatImages.hasPending(), true, 'discard also asks, and was declined');
});

test('confirming back discards the pending changes and returns to the category list', async () => {
  const ui = await boot(); await ui.open();
  await ui.pick(1, ui.file('a.png')); await ui.click('[data-cim="back"]');
  assert.equal(ui.w.CatImages.isOpen(), false); assert.ok(ui.$('#catList'));
  assert.equal(ui.img(1), OLD('fashion'));
});

test('a non-image file is refused and nothing becomes pending', async () => {
  const ui = await boot(); await ui.open();
  await ui.pick(1, ui.file('doc.pdf', 'application/pdf'));
  assert.equal(ui.w.CatImages.hasPending(), false);
  assert.ok(ui.log.toasts.some(t => t.err));
});
