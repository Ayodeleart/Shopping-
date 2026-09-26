/* Pcx.MultiImagePicker: getLinkable() / getUploadRemap() — lets colour-photo linking (product-attributes.js)
 * work on photos that are still local (chosen but not yet uploaded), then follow them to their real url once
 * MultiImagePicker#resolve() uploads them. See product-attributes.test.js for the colour-linking side. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function j(x) { return JSON.parse(JSON.stringify(x)); }   // cross-realm plain value, for comparing jsdom-made values

function boot() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  // MultiImagePicker calls URL.createObjectURL(file) on every chosen file; jsdom doesn't implement it.
  let n = 0;
  w.URL.createObjectURL = () => 'blob:test-' + (++n);
  w.URL.revokeObjectURL = () => {};
  w.safeHref = (u) => u;   // used by the picker's <img src>; the real page defines it elsewhere
  const code = fs.readFileSync(path.join(__dirname, '..', 'components', 'multi-image-picker.js'), 'utf8');
  w.eval(code);
  const el = w.document.getElementById('root');
  const picker = new w.Pcx.MultiImagePicker(el, { max: 8, label: 'Add photos' });
  return { w, el, picker };
}

function fakeFile(name) {
  return { name, type: 'image/jpeg' };   // MultiImagePicker only reads .type / .name, never the bytes
}

test('getLinkable(): a photo chosen but not yet uploaded is still offered, by its local preview url', () => {
  const { picker } = boot();
  picker._add([fakeFile('a.jpg')]);
  assert.deepEqual(j(picker.getImages()), [], 'not uploaded yet -> not a real url');
  assert.equal(picker.getLinkable().length, 1, 'but it IS linkable, by its preview url');
  assert.match(picker.getLinkable()[0], /^blob:/);
});

test('getLinkable(): mixes already-uploaded photos (edit mode) and freshly-chosen ones (create mode), in order', () => {
  const { picker } = boot();
  picker.setImages(['https://x/existing.jpg']);
  picker._add([fakeFile('new.jpg')]);
  assert.deepEqual(j(picker.getLinkable()), ['https://x/existing.jpg', picker.items[1].preview]);
});

test('getUploadRemap(): maps a preview url to its real url once resolve() uploads it, and only for photos uploaded this call', () => {
  const { picker } = boot();
  picker.setImages(['https://x/existing.jpg']);              // no remap entry expected for this one
  picker._add([fakeFile('new.jpg')]);
  const previewUrl = picker.items[1].preview;
  return picker.resolve(async () => 'https://x/uploaded.jpg').then(() => {
    const map = j(picker.getUploadRemap());
    assert.deepEqual(map, { [previewUrl]: 'https://x/uploaded.jpg' });
    assert.deepEqual(j(picker.getImages()), ['https://x/existing.jpg', 'https://x/uploaded.jpg']);
  });
});
