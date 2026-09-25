/* Pcx.ProductAttributes: colour picker + colour-photo linking (colorGroup / getImages / colorImages / refreshColorImages).
 * The vendor/admin colours picker links one of the product's OWN uploaded photos to a colour (never a fabricated
 * image): this is what the Home card swatch and product-page colour selector switch to. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function j(x) { return JSON.parse(JSON.stringify(x)); }        // cross-realm plain object, for comparing jsdom-made values
function colourChip(root, n) {                                 // n-th colour chip specifically (colours are the only chips with a swatch dot)
  return [...root.querySelectorAll('.pa-chip')].filter(c => c.querySelector('.pa-dot'))[n || 0];
}

function boot(getImages) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  const code = fs.readFileSync(path.join(__dirname, '..', 'components', 'product-attributes.js'), 'utf8');
  w.eval(code);
  const el = w.document.getElementById('root');
  const attrs = new w.Pcx.ProductAttributes(el, { getImages: getImages || (() => []) });
  return { w, el, attrs };
}

test('colours: expanded, real, distinguishable palette (every hex is unique)', () => {
  const { attrs } = boot();
  attrs.setCategory('Dresses');
  const hexes = Object.values(attrs.o ? {} : {}); // palette itself is private; check via rendered swatches instead
  attrs.load({}, 'Dresses');
  const dots = [...attrs.root.querySelectorAll('.pa-chip .pa-dot')].map(d => d.getAttribute('style'));
  assert.ok(dots.length >= 25, 'palette has real breadth, not the old ~17');
  assert.equal(new Set(dots).size, dots.length, 'no two colours share the exact same swatch colour');
});

test('colour-photo linking: only colours the vendor selected get a thumbnail row, and only uploaded photos are offered', () => {
  const photos = ['https://x/1.jpg', 'https://x/2.jpg'];
  const { attrs } = boot(() => photos);
  attrs.load({}, 'Dresses');
  colourChip(attrs.root).click();                                     // select the first colour (Black)
  const rows = attrs.root.querySelectorAll('.pa-colorimg-row');
  assert.equal(rows.length, 1, 'a row appears only for the selected colour');
  const thumbs = rows[0].querySelectorAll('.pa-colorimg-thumb');
  assert.equal(thumbs.length, 2, 'offers exactly the product\'s own uploaded photos, no more');
  thumbs[0].click();
  assert.deepEqual(j(attrs.collect().colorImages), { Black: photos[0] }, 'linked photo is saved on collect()');
});

test('colour-photo linking: honest empty state when no photos have been uploaded yet, no fabricated image', () => {
  const { attrs } = boot(() => []);
  attrs.load({}, 'Dresses');
  colourChip(attrs.root).click();
  const row = attrs.root.querySelector('.pa-colorimg-row');
  assert.equal(row.querySelector('.pa-colorimg-thumb'), null);
  assert.match(row.textContent, /Add photos above/);
});

test('deselecting a colour drops its linked photo from collect()', () => {
  const { attrs } = boot(() => ['https://x/1.jpg']);
  attrs.load({}, 'Dresses');
  const chip = colourChip(attrs.root);
  chip.click();
  attrs.root.querySelector('.pa-colorimg-thumb').click();
  assert.equal(attrs.collect().colorImages.Black, 'https://x/1.jpg');
  chip.click();                                                       // deselect Black
  assert.equal(attrs.collect().colorImages, undefined, 'no colours left, so no colorImages at all');
});

test('refreshColorImages() picks up photos uploaded after the colour was already selected', () => {
  let photos = [];
  const { attrs } = boot(() => photos);
  attrs.load({}, 'Dresses');
  colourChip(attrs.root).click();
  assert.equal(attrs.root.querySelectorAll('.pa-colorimg-thumb').length, 0);
  photos = ['https://x/new.jpg'];                                     // vendor just uploaded a photo
  attrs.refreshColorImages();
  assert.equal(attrs.root.querySelectorAll('.pa-colorimg-thumb').length, 1);
});

test('load() round-trips colorImages exactly as saved, and clear() drops it', () => {
  const { attrs } = boot(() => ['https://x/1.jpg']);
  attrs.load({ colors: ['Black'], colorImages: { Black: 'https://x/1.jpg' } }, 'Dresses');
  assert.deepEqual(j(attrs.collect().colorImages), { Black: 'https://x/1.jpg' });
  attrs.clear();
  attrs.load({}, 'Dresses');
  assert.equal(attrs.collect().colorImages, undefined);
});

test('a colour can have several photos: tap order sets colorGallery order, first tap stays the primary colorImages entry', () => {
  const photos = ['https://x/front.jpg', 'https://x/back.jpg', 'https://x/side.jpg'];
  const { attrs } = boot(() => photos);
  attrs.load({}, 'Dresses');
  colourChip(attrs.root).click();                                     // select Black
  const thumbs = () => [...attrs.root.querySelectorAll('.pa-colorimg-thumb')];
  thumbs()[1].click();                                                // back first (becomes primary)
  thumbs()[0].click();                                                // then front
  assert.deepEqual(j(attrs.collect().colorGallery), { Black: [photos[1], photos[0]] }, 'gallery keeps tap order');
  assert.equal(attrs.collect().colorImages.Black, photos[1], 'primary is the first photo tapped, for the storefront');
  assert.ok(thumbs()[1].classList.contains('primary'), 'primary thumb is marked');
  thumbs()[1].click();                                                // untap the primary photo
  assert.deepEqual(j(attrs.collect().colorGallery), { Black: [photos[0]] }, 'removing a linked photo leaves the rest, re-ordered');
  assert.equal(attrs.collect().colorImages.Black, photos[0]);
});

test('remapColorImages() moves a colour link from a photo\'s temporary preview url to its real uploaded url', () => {
  let photos = ['blob:temp-1'];
  const { attrs } = boot(() => photos);
  attrs.load({}, 'Dresses');
  colourChip(attrs.root).click();
  attrs.root.querySelector('.pa-colorimg-thumb').click();             // link the still-local photo
  assert.equal(attrs.collect().colorImages.Black, 'blob:temp-1');
  photos = ['https://cdn.example/real-1.jpg'];                        // photo just finished uploading
  attrs.remapColorImages({ 'blob:temp-1': 'https://cdn.example/real-1.jpg' });
  assert.equal(attrs.collect().colorImages.Black, 'https://cdn.example/real-1.jpg', 'the link survived the upload');
});

test('load() migrates a legacy single-photo-per-colour save into a one-photo colorGallery', () => {
  const { attrs } = boot(() => ['https://x/1.jpg', 'https://x/2.jpg']);
  attrs.load({ colors: ['Black'], colorImages: { Black: 'https://x/1.jpg' } }, 'Dresses');
  assert.deepEqual(j(attrs.collect().colorGallery), { Black: ['https://x/1.jpg'] });
  attrs.root.querySelectorAll('.pa-colorimg-thumb')[1].click();       // add a second photo on top of the migrated one
  assert.deepEqual(j(attrs.collect().colorGallery), { Black: ['https://x/1.jpg', 'https://x/2.jpg'] });
  assert.equal(attrs.collect().colorImages.Black, 'https://x/1.jpg', 'primary is unchanged');
});

test('mixed / multi-colour products: a combination is stored as typed, not forced into a generic value', () => {
  const { attrs } = boot();
  attrs.load({}, 'Dresses');
  const colourFld = [...attrs.root.querySelectorAll('.pa-fld')].find(f => f.querySelector('label').textContent.startsWith('Colours'));
  const input = colourFld.querySelector('.pa-add input');
  input.value = 'Black/White';
  colourFld.querySelector('.pa-add .pa-addbtn').click();
  assert.ok(attrs.collect().colors.includes('Black/White'), 'the combined colour value is preserved exactly');
});

test('materials: clothing offers a tappable, category-relevant material list (not a bare text box) and still allows a custom value', () => {
  const { attrs } = boot();
  attrs.load({}, 'Dresses');                                          // -> clothing template
  const fields = [...attrs.root.querySelectorAll('.pa-fld')];
  const materialFld = fields.find(f => f.querySelector('label').textContent.startsWith('Material'));
  assert.ok(materialFld, 'material field is rendered');
  const chips = [...materialFld.querySelectorAll('.pa-chip')].map(c => c.textContent);
  assert.ok(chips.includes('Cotton') && chips.includes('Ankara') && chips.includes('Lace'), 'fashion-relevant materials are offered as chips');
  assert.ok(materialFld.querySelector('.pa-add input'), 'a custom material can still be typed in');
});

test('materials: jeans/trousers prioritise Denim-relevant materials first', () => {
  const { attrs } = boot();
  attrs.load({}, 'Jeans');                                            // -> bottoms template
  const fields = [...attrs.root.querySelectorAll('.pa-fld')];
  const materialFld = fields.find(f => f.querySelector('label').textContent.startsWith('Material'));
  const chips = [...materialFld.querySelectorAll('.pa-chip')].map(c => c.textContent);
  assert.deepEqual(chips.slice(0, 4), ['Denim', 'Cotton', 'Stretch Denim', 'Polyester']);
});
