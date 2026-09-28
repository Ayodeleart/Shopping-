/* Marcato-branded skeleton loading + bigger card colour swatches.
 *
 * Covers the two changes made to the shared product card system (components/product-card.js/.css):
 *   1. LOADING: skeleton cards/rails are branded ("MARCATO" in the image box), mirror the real card's
 *      structure, contain no fabricated product text, and every per-card image placeholder is temporary —
 *      it resolves to the real photo (onload) or to the graceful no-image fallback (onerror), never an
 *      endless animation.
 *   2. SWATCHES: visible dots are bigger with a padded invisible hit area, at most SWATCH_CAP real dots
 *      plus a truthful "+N" chip, and tapping a dot selects the colour WITHOUT opening the product or
 *      adding to the cart. Real colour->image mappings still drive the photo swap.
 *
 * The full boot-level skeleton lifecycle (shown while a category resolves, removed after, empty state only
 * after the query) is already covered by tests/discover-category-surface.test.js against the same classes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* A minimal page that loads the REAL card renderer with the host-page contract stubbed, and with
   runScripts:'dangerously' so the cards' inline onclick/onload/onerror attributes actually run. */
function makeWin() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://shop.test/', runScripts: 'dangerously', pretendToBeVisual: true
  });
  const w = dom.window;
  w.eval(
    "var cart = []; var favs = new Set(); var ratingMap = {}; var allProds = [];\n" +
    "var num = function (v) { return Number(v); };\n" +
    "var safeUrl = function (u) { return u; };\n" +
    "var fmt = function (n) { return '\\u20a6' + Number(n).toLocaleString('en-NG'); };\n" +
    "var calls = { openProduct: [], addToCart: [] };\n" +
    "function openProduct(id) { calls.openProduct.push(id); }\n" +
    "function addToCart(id, src) { calls.addToCart.push(id); }\n" +
    "function toggleFav() {} function flyToCart() {} function saveCart() {} function updateCartBadge() {}\n"
  );
  /* product-attributes first so swatchHTML never has to lazily inject a <script> (no network in jsdom) */
  w.eval(read('components/product-attributes.js') + '\n;\n' + read('components/variants.js') + '\n;\n' + read('components/product-card.js'));
  return { dom, w };
}

const SIX_COLOURS = { id: 10, name: 'Ankara Tote', price: 3000, stock: 4, image_url: 'https://x/base.jpg',
  attributes: { colors: ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow'], colorImages: { Red: 'https://x/red.jpg' } } };

test('swatches: at most 4 big dots + a truthful "+N" chip; a tap selects the colour and never opens the product or the cart', t => {
  const { dom, w } = makeWin();
  t.after(() => dom.window.close());
  w.allProds.push(SIX_COLOURS);
  const box = w.document.createElement('div');
  box.innerHTML = w.cardHTML(SIX_COLOURS);
  w.document.body.appendChild(box);

  const dots = box.querySelectorAll('.pcSwatch');
  assert.equal(dots.length, 4, 'the card shows SWATCH_CAP (4) real colour dots on one line');
  const more = box.querySelector('.pcSwatchMore');
  assert.equal(more.textContent.trim(), '+2', 'the remaining real colours are counted truthfully, never invented');

  /* tapping a dot: selects, updates aria state, and is fully contained (no navigation, no cart) */
  dots[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(dots[0].classList.contains('on'), 'tapped dot gets the selected ring state');
  assert.equal(dots[0].getAttribute('aria-pressed'), 'true');
  assert.equal(w.calls.openProduct.length, 0, 'a swatch tap never opens the product page');
  assert.equal(w.calls.addToCart.length, 0, 'a swatch tap never adds to cart');

  /* the "+N" chip is the one deliberate way from the swatch row into the product (all colours live there) */
  more.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(Array.from(w.calls.openProduct), [10], 'the +N chip opens the product to show every colour');

  /* the real colour->image mapping still drives the card photo (and only when a mapping exists) */
  const img = box.querySelector('.pcImg img');
  w.pickCardColor(10, 'Black');                       /* deselect from the click above; Black has no linked photo */
  w.pickCardColor(10, 'Black');
  assert.equal(img.src, 'https://x/base.jpg', 'no linked photo for Black: the real photo stays');
  w.pickCardColor(10, 'Black');
  w.pickCardColor(10, 'Red');
  assert.equal(img.src, 'https://x/red.jpg', 'Red has a vendor-linked photo: the card swaps to it');
});

test('swatch CSS: visibly bigger circles, padded invisible hit area, a ring for selected that never hides the colour', () => {
  const css = read('components/product-card.css');
  const dot = css.match(/\.pcSwatch\{[^}]*\}/s)[0];
  const w = Number(dot.match(/width:(\d+)px/)[1]);
  assert.ok(w >= 18, 'visible dot is at least 18px (was 13px)');
  assert.match(css, /\.pcSwatch::after\{[^}]*inset:-7px/, 'each dot carries an invisible ~32px tap pad');
  assert.match(css, /\.pcSwatch\.on\{[^}]*var\(--red\)/, 'selected state is a brand ring');
  assert.match(css.match(/\.pcSwatch\.on\{[^}]*\}/s)[0], /inset 0 0 0 2px var\(--card\)/, 'the ring sits around a card-coloured gap so the colour itself stays visible');
  assert.match(css, /\.pcSwatches\{[^}]*gap:7px/, 'clear spacing between neighbouring dots');
  assert.match(css, /\.pcSwatchMore\{[^}]*height:20px/, 'the +N chip grew with the dots');
});

test('card image loading: branded placeholder until the photo paints, graceful fallback on failure — never endless', t => {
  const { dom, w } = makeWin();
  t.after(() => dom.window.close());
  const box = w.document.createElement('div');
  box.innerHTML = w.cardHTML(SIX_COLOURS) + w.cardHTML({ ...SIX_COLOURS, id: 11, name: 'No Photo', image_url: null, attributes: {} });
  w.document.body.appendChild(box);
  const [withImg, noImg] = box.querySelectorAll('.pcard');

  const media = withImg.querySelector('.pcImg');
  assert.ok(media.classList.contains('pcImgPend'), 'the media box is marked pending (branded placeholder) while the photo downloads');
  media.querySelector('img').dispatchEvent(new w.Event('load'));
  assert.ok(!media.classList.contains('pcImgPend'), 'the placeholder is removed the moment the real photo paints');

  assert.ok(!noImg.querySelector('.pcImg').classList.contains('pcImgPend'), 'a product with no photo is never marked as loading');
  assert.ok(noImg.querySelector('.noImgPh'), 'it shows the plain no-image fallback instead');

  /* a failing photo resolves to the same graceful fallback, not an endless shimmer */
  const box2 = w.document.createElement('div');
  box2.innerHTML = w.cardHTML(SIX_COLOURS);
  w.document.body.appendChild(box2);
  const media2 = box2.querySelector('.pcImg');
  media2.querySelector('img').dispatchEvent(new w.Event('error'));
  assert.ok(!media2.classList.contains('pcImgPend'), 'pending state is cleared on error');
  assert.equal(media2.querySelector('img'), null, 'the broken image is gone');
  assert.ok(media2.querySelector('.noImgPh'), 'replaced by the graceful no-image fallback');

  /* a colour-linked photo that fails falls back to the product's own real photo first */
  const box3 = w.document.createElement('div');
  box3.innerHTML = w.cardHTML(SIX_COLOURS);
  w.document.body.appendChild(box3);
  const img3 = box3.querySelector('.pcImg img');
  img3.dataset.origSrc = 'https://x/base.jpg';
  img3.src = 'https://x/red.jpg';
  img3.dispatchEvent(new w.Event('error'));
  assert.equal(img3.src, 'https://x/base.jpg', 'failed colour photo falls back to the real product photo, never a fabricated one');
});

test('skeletons: branded, structural mirrors of the real cards, with no fabricated product data', t => {
  const { dom, w } = makeWin();
  t.after(() => dom.window.close());
  const box = w.document.createElement('div');
  box.innerHTML = w.skelCardHTML() + w.skelCardHTML({ compact: true }) + w.skelRailHTML(3);
  w.document.body.appendChild(box);

  const [grid, compact] = box.querySelectorAll(':scope > .pcard-skel');
  assert.ok(grid.classList.contains('pcard') && grid.querySelector('.pcImg') && grid.querySelector('.pcBody'), 'grid skeleton uses the real card boxes (same footprint, no layout shift)');
  assert.equal(grid.getAttribute('aria-hidden'), 'true', 'skeletons are hidden from assistive tech');
  assert.ok(grid.querySelector('.skl-btn'), 'grid skeleton reserves the Add to Cart row');
  assert.ok(grid.querySelector('.skl-dots'), 'grid skeleton reserves the swatch row');
  assert.ok(compact.classList.contains('pcard-compact'), 'rail skeleton matches the compact merchandising card');
  assert.equal(compact.querySelector('.skl-btn'), null, 'compact skeleton has no button row — compact cards have none');
  assert.equal(box.textContent.trim(), '', 'skeletons contain NO text: no fake names, prices, ratings or discounts');

  const rail = box.querySelector('.pcRail-skel');
  assert.equal(rail.querySelectorAll('.fcard-wrap .pcard-skel').length, 3, 'a loading rail is a row of compact skeletons at the real rail card width');
  assert.ok(rail.querySelector('.cpg-msec-scroll'), 'the rail skeleton reuses the real merchandising rail dimensions');

  const css = read('components/product-card.css');
  assert.match(css, /\.pcImgPend::before,\.pcard-skel \.pcImg::before\{[^}]*content:'MARCATO'/s, 'the image area carries the small MARCATO brand mark while loading');
  assert.match(css, /@keyframes pcShimmer\{to\{transform:translateX/, 'the shimmer is transform-only (cheap on mobile)');
  const rm = css.match(/@media \(prefers-reduced-motion:reduce\)\{[^{}]*(\{[^}]*\}[^{}]*)*\}/s)[0];
  assert.match(rm, /animation:none/, 'reduced-motion turns the animations off');
  assert.match(rm, /\.pcImgPend::after/, 'including the image shimmer sweep');
});

test('hosts use the shared branded skeletons (no second loading system), and always clear them', () => {
  const index = read('index.html');
  assert.match(index, /function showGridLoading[\s\S]{0,400}skelCardHTML\(\)/, 'the home/category grid loader renders the shared branded skeleton cards');
  assert.match(index, /catMerch'\)\.innerHTML = skelRailHTML\(\)/, 'the in-place category view shows a branded rail placeholder while the catalogue resolves');
  const store = read('store/store.js');
  assert.match(store, /reloadGrid[\s\S]{0,600}skelCardHTML\(\)/, 'the seller storefront grid uses the same skeleton cards instead of a "Loading…" message');
  assert.match(store, /grid\.removeAttribute\('aria-busy'\)/, 'the storefront clears the busy state when real content (or the empty state) renders');
});
