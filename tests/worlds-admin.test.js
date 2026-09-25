const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeSb } = require('./fakesb');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const J = x => JSON.parse(JSON.stringify(x));
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 12; i++) await tick(); }

const windows = [];
test.after(() => windows.forEach(w => w.close()));

const CATS = [
  { id: 1, parent_id: null, slug: 'food', name: 'Food', sort_order: 1, is_active: true },
  { id: 2, parent_id: 1, slug: 'rice-dishes', name: 'Rice dishes', sort_order: 1, is_active: true },
  { id: 3, parent_id: 1, slug: 'swallow', name: 'Swallow', sort_order: 2, is_active: true },
  { id: 10, parent_id: null, slug: 'fashion-clothing', name: 'Fashion', sort_order: 2, is_active: true }
];
const OLD_IMG = 'https://cdn.test/storage/v1/object/public/avatars/worlds/old-card.jpg';
function seed() {
  return {
    categories: CATS,
    worlds: [
      { slug: 'food', title: 'Food', description: 'Meals', image_url: OLD_IMG, card_gif_url: null, is_active: true, sort_order: 1 },
      { slug: 'fashion', title: 'Fashion', description: 'Style', image_url: null, card_gif_url: null, is_active: true, sort_order: 2 },
      { slug: 'beauty', title: 'Beauty', description: '', image_url: null, card_gif_url: null, is_active: true, sort_order: 3 }
    ],
    world_heroes: [], world_display_categories: [], world_category_links: []
  };
}

/* the admin page, minus Supabase: worlds.js with the globals admin/index.html gives it */
async function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><body><div id="worldsPane"></div></body>', { url: 'https://shop.test/admin/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; windows.push(w);
  const sb = makeSb(opts.seed || seed(), { isAdmin: opts.isAdmin !== false });
  const log = { toasts: [], uploads: [], tus: [] };
  w.sb = sb; w.BUCKET = 'avatars'; w.SB_URL = 'https://proj.supabase.co'; w.SB_KEY = 'anon';
  w.toast = (m, err) => log.toasts.push({ m, err: !!err });
  w.confirm = (t, m, cb) => { log.confirm = { t, m }; cb(); };
  w.showLoad = () => {}; w.hideLoad = () => {};
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () {};
  let n = 0;
  w.uploadImage = async (file, folder, barId, progId, transparent) => {
    log.uploads.push({ folder, type: file.type, name: file.name, transparent: !!transparent });
    return 'https://cdn.test/storage/v1/object/public/avatars/' + folder + '/up' + (++n) + (file.type === 'image/gif' ? '.gif' : '.jpg');
  };
  w.tus = { Upload: class { constructor(file, o) { this.o = o; log.tus.push(o); } findPreviousUploads() { return Promise.resolve([]); } start() { setTimeout(() => { this.o.onProgress(1, 2); this.o.onSuccess(); }, 0); } } };
  ['data/safe.js', 'data/categories.js', 'components/multi-image-picker.js', 'data/worlds.js', 'components/world-sections.js', 'admin/worlds.js'].forEach(f => w.eval(read(f)));
  await w.WorldsAdmin.open(); await settle();
  const $ = s => w.document.querySelector(s), $$ = s => [...w.document.querySelectorAll(s)];
  const ui = {
    w, sb, db: sb._db, log, $, $$,
    click: el => { (typeof el === 'string' ? $(el) : el).click(); return settle(); },
    type(el, v) { el = typeof el === 'string' ? $(el) : el; el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    card: name => $$('.wa-card').find(c => c.querySelector('.wa-name').textContent === name),
    async upload(container, file) {
      const input = container.querySelector('input[type=file]');
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new w.Event('change', { bubbles: true }));
      await settle();
    },
    file: (name, type, size) => new w.File([new Uint8Array(size || 10)], name, { type }),
    async openCard(name) { const c = ui.card(name); if (!c.querySelector('.wa-body')) await ui.click(c.querySelector('.wa-hd')); return ui.card(name); },
    async manage(name) { const c = await ui.openCard(name); await ui.click(c.querySelector('[data-a="manage"]')); }
  };
  return ui;
}
const names = ui => ui.$$('.wa-card .wa-name').map(e => e.textContent);

/* ------------------------------------------------------------------ worlds */
test('admin: create a world; it is stored, appears in the enabled list the homepage reads, and its card image + GIF upload', async () => {
  const ui = await boot();
  assert.deepEqual(names(ui), ['Food', 'Fashion', 'Beauty']);
  await ui.click('[data-a="add-world"]');
  const card = ui.$('.wa-card');                                     // the new one is first and open
  ui.type(card.querySelector('[data-f="title"]'), 'Electronics');
  ui.type(card.querySelector('[data-f="description"]'), 'Gadgets and more');
  await ui.upload(card.querySelector('[data-pk="image"]'), ui.file('card.png', 'image/png'));
  await ui.upload(card.querySelector('[data-pk="gif"]'), ui.file('card.gif', 'image/gif'));
  assert.deepEqual(ui.log.uploads.map(u => [u.folder, u.type]), [['worlds', 'image/png'], ['worlds', 'image/gif']]);
  await ui.click(card.querySelector('[data-a="save"]'));
  const row = ui.db.tables.worlds.find(w => w.slug === 'electronics');
  assert.ok(row, 'inserted');
  assert.equal(row.title, 'Electronics'); assert.equal(row.description, 'Gadgets and more');
  assert.match(row.image_url, /worlds\/up1\.jpg$/); assert.match(row.card_gif_url, /worlds\/up2\.gif$/);
  assert.equal(row.sort_order, 4); assert.equal(row.is_active, true);
  const list = (await ui.w.Worlds.fetch(ui.sb)).list;
  assert.equal(list[list.length - 1].slug, 'electronics');           // shows on the homepage
  assert.equal(list[list.length - 1].gif_url, row.card_gif_url);
  assert.ok(ui.log.toasts.some(t => /World saved/.test(t.m) && !t.err));
});

test('admin: media rules. PNG/JPG/WEBP/GIF only, the GIF slot takes only GIFs, big GIFs use the resumable upload, over 25 MB is refused', async () => {
  const ui = await boot();
  const card = await ui.openCard('Fashion');
  await ui.upload(card.querySelector('[data-pk="image"]'), ui.file('a.heic', 'image/heic'));
  assert.match(ui.log.toasts.at(-1).m, /PNG, JPG, WEBP or GIF/); assert.equal(ui.log.uploads.length, 0);
  await ui.upload(card.querySelector('[data-pk="gif"]'), ui.file('pic.png', 'image/png'));
  assert.match(ui.log.toasts.at(-1).m, /slot is for GIF/); assert.equal(ui.log.uploads.length, 0);
  await ui.upload(card.querySelector('[data-pk="image"]'), ui.file('a.webp', 'image/webp'));
  assert.equal(ui.log.uploads.at(-1).type, 'image/webp');
  const big = ui.file('big.gif', 'image/gif', 7 * 1024 * 1024);
  await ui.upload(ui.card('Fashion').querySelector('[data-pk="gif"]'), big);
  assert.equal(ui.log.tus.length, 1, 'resumable upload used');
  assert.equal(ui.log.uploads.length, 1, 'the standard upload was not used for the big GIF');
  assert.match(ui.log.tus[0].metadata.objectName, /^worlds\/\d+_[a-z0-9]+\.gif$/);
  assert.equal(ui.log.tus[0].metadata.bucketName, 'avatars'); assert.equal(ui.log.tus[0].metadata.contentType, 'image/gif');
  assert.equal(ui.log.tus[0].headers.authorization, 'Bearer tok');
  const huge = ui.file('huge.gif', 'image/gif', 26 * 1024 * 1024);
  await ui.upload((await ui.openCard('Beauty')).querySelector('[data-pk="image"]'), huge);
  assert.match(ui.log.toasts.at(-1).m, /over 25 MB/);
  const small = ui.file('s.gif', 'image/gif', 1000);
  await ui.upload(ui.card('Beauty').querySelector('[data-pk="image"]'), small);            // a GIF in the image slot keeps animating (goes up untouched)
  assert.equal(ui.log.uploads.at(-1).type, 'image/gif');
});

test('admin: hide / show a world; the homepage list follows', async () => {
  const ui = await boot();
  let c = await ui.openCard('Beauty');
  await ui.click(c.querySelector('[data-a="tgl"]'));
  c = ui.card('Beauty'); await ui.click(c.querySelector('[data-a="save"]'));
  assert.equal(ui.db.tables.worlds.find(w => w.slug === 'beauty').is_active, false);
  ui.db.isAdmin = false;
  assert.deepEqual(J((await ui.w.Worlds.fetch(ui.sb)).list.map(w => w.slug)), ['food', 'fashion']);
  ui.db.isAdmin = true;
  c = await ui.openCard('Beauty'); await ui.click(c.querySelector('[data-a="tgl"]'));
  await ui.click(ui.card('Beauty').querySelector('[data-a="save"]'));
  ui.db.isAdmin = false;
  assert.deepEqual(J((await ui.w.Worlds.fetch(ui.sb)).list.map(w => w.slug)), ['food', 'fashion', 'beauty']);
});

test('admin: re-order with the arrows; the order is stored and the homepage follows; nothing typed elsewhere is lost', async () => {
  const ui = await boot();
  let c = await ui.openCard('Food');
  ui.type(c.querySelector('[data-f="title"]'), 'Food & Drinks');           // unsaved edit on another card
  await ui.click(ui.card('Beauty').querySelector('[data-a="up"]'));
  assert.deepEqual(names(ui).map(n => n.replace('Food & Drinks', 'Food')), ['Food', 'Beauty', 'Fashion']);
  assert.equal(ui.card('Food & Drinks').querySelector('[data-f="title"]').value, 'Food & Drinks');   // draft survived the re-draw
  assert.deepEqual(J(ui.db.tables.worlds.map(w => [w.slug, w.sort_order])), [['food', 1], ['fashion', 3], ['beauty', 2]]);
  assert.equal(ui.db.tables.worlds[0].title, 'Food');                          // ... and it is still unsaved
  ui.db.isAdmin = false;
  assert.deepEqual(J((await ui.w.Worlds.fetch(ui.sb)).list.map(w => w.slug)), ['food', 'beauty', 'fashion']);
});

test('admin: slug rules (auto from title, valid characters, unique), editing a slug keeps the world\'s content attached', async () => {
  const ui = await boot();
  await ui.click('[data-a="add-world"]');
  let c = ui.$('.wa-card');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.match(ui.log.toasts.at(-1).m, /title/i);
  ui.type(c.querySelector('[data-f="title"]'), 'Electronics & Gadgets');
  ui.type(c.querySelector('[data-f="slug"]'), 'Bad Slug!');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.match(ui.log.toasts.at(-1).m, /lower-case letters/);
  ui.type(c.querySelector('[data-f="slug"]'), 'food');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.match(ui.log.toasts.at(-1).m, /already used/); assert.equal(ui.log.toasts.at(-1).err, true);
  ui.type(c.querySelector('[data-f="slug"]'), '');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.ok(ui.db.tables.worlds.find(w => w.slug === 'electronics-gadgets'));   // built from the title
  ui.db.tables.world_display_categories.push({ id: 1, world_slug: 'fashion', name: 'Tops', is_active: true, sort_order: 1 });
  c = await ui.openCard('Fashion');
  ui.type(c.querySelector('[data-f="slug"]'), 'style');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.equal(ui.db.tables.world_display_categories[0].world_slug, 'style');
});

test('admin: delete a world; it disappears from the homepage, its hero/categories go with it, its uploaded files are removed', async () => {
  const ui = await boot();
  ui.db.tables.world_heroes.push({ id: 1, world_slug: 'food', image_url: 'https://cdn.test/storage/v1/object/public/avatars/worlds/hero/h.jpg', gif_url: null, is_active: true, sort_order: 1 });
  ui.db.tables.world_display_categories.push({ id: 1, world_slug: 'food', name: 'Rice', image_url: 'https://cdn.test/storage/v1/object/public/avatars/worlds/categories/r.png', gif_url: 'https://cdn.test/storage/v1/object/public/avatars/worlds/categories/r.gif', is_active: true, sort_order: 1 });
  ui.db.tables.world_category_links.push({ display_category_id: 1, category_id: 2 });
  const c = await ui.openCard('Food');
  await ui.click(c.querySelector('[data-a="del"]'));
  assert.match(ui.log.confirm.m, /hero slides and display categories/);
  assert.ok(!ui.db.tables.worlds.some(w => w.slug === 'food'));
  assert.equal(ui.db.tables.world_heroes.length, 0); assert.equal(ui.db.tables.world_display_categories.length, 0); assert.equal(ui.db.tables.world_category_links.length, 0);
  assert.deepEqual(J(ui.db.storage.removed.sort()), ['worlds/categories/r.gif', 'worlds/categories/r.png', 'worlds/hero/h.jpg', 'worlds/old-card.jpg']);
  assert.deepEqual(names(ui), ['Fashion', 'Beauty']);
  ui.db.isAdmin = false;
  assert.ok(!(await ui.w.Worlds.fetch(ui.sb)).list.some(w => w.slug === 'food'));
});

test('admin: replacing a card image removes the old file from Storage; files outside worlds/ are never touched', async () => {
  const ui = await boot();
  let c = await ui.openCard('Food');
  await ui.click(c.querySelector('[data-pk="image"] .mip__x'));
  c = ui.card('Food');
  await ui.upload(c.querySelector('[data-pk="image"]'), ui.file('new.jpg', 'image/jpeg'));
  await ui.click(ui.card('Food').querySelector('[data-a="save"]'));
  assert.deepEqual(J(ui.db.storage.removed), ['worlds/old-card.jpg']);
  assert.match(ui.db.tables.worlds.find(w => w.slug === 'food').image_url, /worlds\/up1\.jpg/);
  const sd = seed(); sd.worlds[2].image_url = 'https://cdn.test/storage/v1/object/public/avatars/products/keep-me.jpg';
  const ui2 = await boot({ seed: sd });
  await ui2.click((await ui2.openCard('Beauty')).querySelector('[data-a="del"]'));
  assert.ok(!ui2.db.tables.worlds.some(w => w.slug === 'beauty'));
  assert.deepEqual(J(ui2.db.storage.removed), [], 'a file outside worlds/ is never removed');
});

/* ------------------------------------------------------------------ hero + display categories inside a world */
test('admin > Food > Display Categories: add with name, image, GIF, linked product categories; edit; reorder; disable; delete', async () => {
  const ui = await boot();
  await ui.manage('Food');
  assert.match(ui.$('.wa-crumb').textContent, /Food/);
  assert.ok(ui.$$('.wa-sec h3').map(h => h.textContent).includes('FOOD HERO'));
  assert.ok(ui.$$('.wa-sec h3').map(h => h.textContent).includes('FOOD DISPLAY CATEGORIES'));
  await ui.click('[data-a="add-cat"]');
  let c = ui.$('.wa-card');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.match(ui.log.toasts.at(-1).m, /name/i);
  ui.type(c.querySelector('[data-f="name"]'), 'Rice');
  await ui.upload(c.querySelector('[data-pk="image"]'), ui.file('rice.png', 'image/png'));
  await ui.upload(c.querySelector('[data-pk="gif"]'), ui.file('rice.gif', 'image/gif'));
  assert.deepEqual(J(ui.log.uploads.map(u => [u.folder, u.transparent])), [['worlds/categories', true], ['worlds/categories', false]]);   // a PNG keeps its transparency
  assert.ok(c.querySelector('[data-pk="gif"] img'), 'preview is drawn');
  assert.equal(c.querySelector('[data-cid="2"]').closest('.wa-lrow').style.paddingLeft, '28px');           // subcategories are indented under Food
  c.querySelector('[data-cid="2"]').click();
  await ui.click(c.querySelector('[data-a="save"]'));
  const row = ui.db.tables.world_display_categories[0];
  assert.deepEqual(J([row.world_slug, row.name, row.sort_order, row.is_active]), ['food', 'Rice', 1, true]);
  assert.match(row.image_url, /categories\/up1\.jpg$/); assert.match(row.gif_url, /categories\/up2\.gif$/);
  assert.deepEqual(J(ui.db.tables.world_category_links), [{ display_category_id: row.id, category_id: 2 }]);

  for (const nm of ['Swallow', 'Soups']) {
    await ui.click('[data-a="add-cat"]');
    const n = ui.$('.wa-card');
    ui.type(n.querySelector('[data-f="name"]'), nm);
    await ui.click(n.querySelector('[data-a="save"]'));
  }
  assert.deepEqual(names(ui).slice(-3), ['Rice', 'Swallow', 'Soups']);         // saved order = 1, 2, 3
  assert.deepEqual(J(ui.db.tables.world_display_categories.map(x => x.sort_order)), [1, 2, 3]);
  await ui.click(ui.card('Soups').querySelector('[data-a="up"]'));
  assert.deepEqual(names(ui).slice(-3), ['Rice', 'Soups', 'Swallow']);
  assert.deepEqual(J(ui.db.tables.world_display_categories.map(x => [x.name, x.sort_order])), [['Rice', 1], ['Swallow', 3], ['Soups', 2]]);

  c = await ui.openCard('Rice');                                              // re-link: drop Rice dishes, add Swallow
  c.querySelector('[data-cid="2"]').click(); c.querySelector('[data-cid="3"]').click();
  await ui.click(c.querySelector('[data-a="tgl"]'));                          // and switch it off
  await ui.click(ui.card('Rice').querySelector('[data-a="save"]'));
  assert.deepEqual(J(ui.db.tables.world_category_links), [{ display_category_id: row.id, category_id: 3 }]);
  assert.equal(ui.db.tables.world_display_categories.find(x => x.name === 'Rice').is_active, false);
  ui.db.isAdmin = false;
  const cfg = await ui.w.Pcx.WorldSections.load(ui.sb, 'food');
  assert.deepEqual(J(cfg.cats.map(x => x.name)), ['Soups', 'Swallow']);        // disabled one hidden from the storefront, order respected
  ui.db.isAdmin = true;

  c = await ui.openCard('Swallow');
  await ui.click(c.querySelector('[data-a="del"]'));
  assert.ok(!ui.db.tables.world_display_categories.some(x => x.name === 'Swallow'));
  assert.deepEqual(J(ui.db.storage.removed), []);                              // Swallow had no media, and Rice's files were not touched

  c = await ui.openCard('Rice');                                              // deleting one that has media removes its image + GIF
  await ui.click(c.querySelector('[data-a="del"]'));
  assert.deepEqual(J(ui.db.storage.removed.sort()), ['worlds/categories/up1.jpg', 'worlds/categories/up2.gif']);
  assert.equal(ui.db.tables.world_category_links.length, 0);
});

test('admin > Food > Hero: add a slide (image + GIF + button), validation, edit, disable, delete; the storefront follows', async () => {
  const ui = await boot();
  await ui.manage('Food');
  await ui.click('[data-a="hero-toggle"]');
  await ui.click('[data-a="add-hero"]');
  let c = ui.$('.wa-card');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.match(ui.log.toasts.at(-1).m, /image or a GIF/);                       // a slide with no picture is refused
  await ui.upload(c.querySelector('[data-pk="image"]'), ui.file('h.jpg', 'image/jpeg'));
  ui.type(c.querySelector('[data-f="title"]'), 'New season');
  ui.type(c.querySelector('[data-f="subtitle"]'), 'Fresh drops');
  ui.type(c.querySelector('[data-f="cta_type"]'), 'category');
  await ui.click(c.querySelector('[data-f="cta_type"]'));
  c = ui.$('.wa-card');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.match(ui.log.toasts.at(-1).m, /button some text/);                      // a button needs text ...
  ui.type(c.querySelector('[data-f="cta_label"]'), 'Shop now');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.match(ui.log.toasts.at(-1).m, /Choose the category/);                   // ... and a target
  ui.type(c.querySelector('[data-f="cta_value"]'), 'fashion-clothing');
  await ui.click(c.querySelector('[data-a="save"]'));
  const row = ui.db.tables.world_heroes[0];
  assert.deepEqual(J([row.world_slug, row.title, row.subtitle, row.cta_type, row.cta_label, String(row.cta_value), row.is_active]), ['food', 'New season', 'Fresh drops', 'category', 'Shop now', 'fashion-clothing', true]);
  assert.match(row.image_url, /worlds\/hero\/up1\.jpg$/);

  ui.db.isAdmin = false;
  let cfg = await ui.w.Pcx.WorldSections.load(ui.sb, 'food');
  assert.equal(cfg.heroes.length, 1); assert.equal(cfg.heroes[0].title, 'New season');
  assert.equal((await ui.w.Pcx.WorldSections.load(ui.sb, 'beauty')).heroes.length, 0);   // another world never gets it
  ui.db.isAdmin = true;

  await ui.click('[data-a="add-hero"]');                                          // a link button must be https:// or an in-app page
  c = ui.$('.wa-card');
  await ui.upload(c.querySelector('[data-pk="gif"]'), ui.file('h.gif', 'image/gif'));
  ui.type(c.querySelector('[data-f="cta_type"]'), 'link'); await ui.click(c.querySelector('[data-f="cta_type"]'));
  c = ui.$('.wa-card');
  ui.type(c.querySelector('[data-f="cta_label"]'), 'Go'); ui.type(c.querySelector('[data-f="cta_value"]'), 'javascript:alert(1)');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.match(ui.log.toasts.at(-1).m, /must start with https/); assert.equal(ui.db.tables.world_heroes.length, 1);
  ui.type(c.querySelector('[data-f="cta_value"]'), '#world=beauty');
  await ui.click(c.querySelector('[data-a="save"]'));
  assert.equal(ui.db.tables.world_heroes.length, 2); assert.equal(ui.db.tables.world_heroes[1].sort_order, 2);

  c = await ui.openCard('New season');
  await ui.click(c.querySelector('[data-a="tgl"]')); await ui.click(ui.card('New season').querySelector('[data-a="save"]'));
  ui.db.isAdmin = false;
  cfg = await ui.w.Pcx.WorldSections.load(ui.sb, 'food'); ui.w.Pcx.WorldSections.clearCache && ui.w.Pcx.WorldSections.clearCache();
  cfg = await ui.w.Pcx.WorldSections.load(ui.sb, 'food');
  assert.deepEqual(J(cfg.heroes.map(h => [h.title || null, !!h.gif_url])), [[null, true]]);                        // disabled slide hidden; the GIF-only slide remains
  ui.db.isAdmin = true;

  ui.db.storage.removed.length = 0;
  c = await ui.openCard('New season');
  await ui.click(c.querySelector('[data-a="del"]'));
  assert.equal(ui.db.tables.world_heroes.length, 1);
  assert.deepEqual(J(ui.db.storage.removed), ['worlds/hero/up1.jpg']);
});

test('admin > Fashion and Beauty have their own admin, so the generic Hero/Category manager is hidden for them', async () => {
  const ui = await boot();
  let c = await ui.openCard('Fashion');
  assert.equal(c.querySelector('[data-a="manage"]'), null);
  assert.match(c.textContent, /own dedicated admin section/);
  c = await ui.openCard('Beauty');
  assert.equal(c.querySelector('[data-a="manage"]'), null);
  c = await ui.openCard('Food');
  assert.ok(c.querySelector('[data-a="manage"]'), 'Food still uses the generic manager');
});
