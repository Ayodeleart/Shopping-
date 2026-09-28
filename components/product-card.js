/* components/product-card.js
 * The one product-card renderer for every Marcato surface.
 * Moved out of index.html's inline <script> so /store/[slug] (and any
 * future surface) can render the exact same card instead of a second
 * copy of this logic, per the "don't duplicate product-card logic"
 * rule for the seller storefront.
 *
 * Host page contract (already true of index.html before this file
 * existed — nothing here changes that contract):
 *   - `cart`         array of {id, qty, size, color, ...} — current cart lines (size / color null when the product has none)
 *   - `favs`         a Set of favourited product ids
 *   - `ratingMap`    { [product_id]: {avg, n} } real rating rows only
 *   - `fmt(n)`       formats a price for display
 *   - `esc(v)`       escapes text for safe HTML insertion (also exported here)
 *   - saveCart(), updateCartBadge(), flyToCart(src), addToCart(id, src),
 *     toggleFav(id), openProduct(id) — existing global handlers the
 *     rendered markup's onclick attributes call by name.
 * None of these are redefined here if the host page already defines
 * them (index.html keeps its own); this file only defines the pure
 * rendering functions themselves.
 */
if (typeof esc === 'undefined') {
  var esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
const NO_IMG_SVG = sz => `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;

/* ── IMAGE LOADING (per-card, Marcato-branded) ─────────────────
 * While a card's real photo is still downloading, its media box carries `.pcImgPend`, which paints the
 * small branded "MARCATO" placeholder + shimmer (see product-card.css). The class is removed the moment
 * the photo paints (pcImgDone) or fails (pcImgFail) — never an endless loading animation:
 *   - onload  -> real photo, placeholder gone
 *   - onerror -> the same graceful no-image fallback a product without a photo gets
 *   - a colour-linked photo (pickCardColor) that fails falls back to the product's own real photo. */
function pcImgDone(img) {
  const box = img.closest ? img.closest('.pcImg') : null;
  if (box) box.classList.remove('pcImgPend');
}
function pcImgFail(img) {
  if (img.dataset && img.dataset.origSrc && img.getAttribute('src') !== img.dataset.origSrc) {
    img.src = img.dataset.origSrc;                      /* a colour-linked photo failed: back to the real photo */
    return;
  }
  const box = img.closest ? img.closest('.pcImg') : null;
  if (box) box.classList.remove('pcImgPend');
  const ph = document.createElement('div');
  ph.className = 'noImgPh';
  ph.innerHTML = NO_IMG_SVG(img.closest && img.closest('.pcard-compact') ? 30 : 36);
  img.replaceWith(ph);
}

/* ── BRANDED LOADING SKELETONS (shared, temporary by design) ───
 * skelCardHTML()                 one standard grid-card skeleton (image box + name/price/meta/swatch/button bars)
 * skelCardHTML({compact:true})   one merchandising rail-card skeleton (image + name/price bars only)
 * skelRailHTML(n)                a whole horizontal rail: neutral header bar + n compact card skeletons
 * The markup mirrors the real cards' structure (same .pcImg / .pcBody boxes) so a skeleton occupies the
 * same footprint the real card will — content appearing causes no layout jump. Callers must always
 * REPLACE these with real content, an empty state or an error state once their data resolves. */
function skelCardHTML(opts) {
  const compact = !!(opts && opts.compact);
  const body = compact
    ? '<span class="skl skl-txt"></span><span class="skl skl-txt w60"></span><span class="skl skl-price"></span>'
    : '<span class="skl skl-txt"></span><span class="skl skl-txt w60"></span><span class="skl skl-price"></span>' +
      '<span class="skl skl-meta"></span>' +
      '<span class="skl-dots"><i class="skl"></i><i class="skl"></i><i class="skl"></i><i class="skl"></i></span>' +
      '<span class="skl skl-btn"></span>';
  return `<div class="pcard pcard-skel${compact ? ' pcard-compact' : ''}" aria-hidden="true">` +
    `<div class="pcImg"></div><div class="pcBody${compact ? ' pcBody-compact' : ''}">${body}</div></div>`;
}
function skelRailHTML(n) {
  const cards = new Array(n == null ? 4 : n).fill(`<div class="fcard-wrap">${skelCardHTML({ compact: true })}</div>`).join('');
  return '<div class="cpg-msec pcRail-skel" aria-hidden="true">' +
    '<div class="cpg-msec-hd"><span class="skl skl-hdbar"></span></div>' +
    `<div class="cpg-msec-scroll">${cards}</div></div>`;
}

/* ── STARS (real ratings only) ────────────────────── */
function starsHTML(avg, px) {
  const pct = Math.max(0, Math.min(100, avg / 5 * 100));
  const star = `<svg width="${esc(px)}" height="${esc(px)}" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const row = star.repeat(5);
  return `<span class="stars" role="img" aria-label="${avg.toFixed(1)} out of 5"><span class="st-bg">${row}</span><span class="st-fg" style="width:${pct}%">${row}</span></span>`;
}

/* ── PRODUCT CARD (JUMIA STYLE) ───────────────────── */
/* Add to Cart turns into a - 1 + stepper once the product is in the cart (see ctlHTML / syncCardCtls). */
function plainLine(id) { return cart.find(x => x.id === id && !x.size && !x.color); }

/* Colour swatches on a card (real colours only, from the product's own attributes.colors — see Pcx.Variants).
   Tapping one selects it and, if the vendor/admin linked one of the product's own photos to that colour, swaps the
   card's photo to it (Pcx.Variants.image); it never opens the product page or the cart. The "Add to Cart" button
   still opens the shared bottom sheet to make the pick official and put it in the cart.

   Pcx.Variants.swatch(c) needs components/product-attributes.js for the colour-name -> CSS-colour map, but that
   file is loaded lazily (only once a product detail page is opened — see index.html's ensureAttrLib) to keep it
   off the homepage's initial payload. The very first card render on a fresh page load therefore has no map yet,
   so every dot would render with no background — a plain white/default button. Cards fix this the same way the
   product detail page's colour picker already does: render once immediately (so colours already loaded, e.g. the
   user already opened a product this session, still show right away), then load the map and repaint every dot
   already on the page. window.__attrLibPromise is shared with index.html's own loader so only one script tag is
   ever injected regardless of which caller (a card, or the detail page) asks for it first. */
const cardColorPick = {};
function ensureProductAttributes() {
  if (window.Pcx && Pcx.ProductAttributes) return Promise.resolve();
  if (!window.__attrLibPromise) {
    window.__attrLibPromise = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'components/product-attributes.js'; sc.onload = res; sc.onerror = rej;
      document.head.appendChild(sc);
    });
  }
  return window.__attrLibPromise;
}
function repaintSwatchColors() {
  if (!(window.Pcx && Pcx.Variants)) return;
  document.querySelectorAll('.pcSwatch[data-color]').forEach(b => {
    const sw = Pcx.Variants.swatch(b.getAttribute('data-color'));
    if (sw) b.style.background = sw;
  });
}
/* A card shows at most SWATCH_CAP real colour dots on one line; any extra real colours are counted in a
   "+N" chip that opens the product (never invented, never a second wrapped row — a wrapped row is what
   made card heights inconsistent across the grid). The row is ALWAYS rendered, even empty, so a product
   with no colours reserves the same .pcSwatches height as one with colours — cards in the same row line up. */
const SWATCH_CAP = 4;
function swatchHTML(p) {
  const cols = (window.Pcx && Pcx.Variants) ? Pcx.Variants.colors(p) : [];
  if (!cols.length) return '<div class="pcSwatches"></div>';
  if (!(window.Pcx && Pcx.ProductAttributes)) ensureProductAttributes().then(repaintSwatchColors);
  const picked = cardColorPick[p.id];
  const shown = cols.slice(0, SWATCH_CAP), extra = cols.length - shown.length;
  return `<div class="pcSwatches" onclick="event.stopPropagation()">${shown.map(c => {
    const sw = Pcx.Variants.swatch(c);
    return `<button type="button" class="pcSwatch${picked === c ? ' on' : ''}" aria-label="${esc(c)}" aria-pressed="${picked === c}" data-color="${esc(c)}" style="${sw ? `background:${esc(sw)}` : ''}" data-pcid="${num(p.id)}" onclick="pickCardColor(${num(p.id)},'${esc(c).replace(/'/g, "\\'")}')"></button>`;
  }).join('')}${extra > 0 ? `<button type="button" class="pcSwatchMore" aria-label="${esc(extra)} more colours" onclick="openProduct(${num(p.id)})">+${esc(extra)}</button>` : ''}</div>`;
}
function pickCardColor(id, c) {
  cardColorPick[id] = cardColorPick[id] === c ? null : c;
  document.querySelectorAll(`.pcSwatch[data-pcid="${id}"]`).forEach(b => {
    const on = b.getAttribute('aria-label') === cardColorPick[id];
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
  /* if the vendor/admin linked a photo to this colour, show it; otherwise stay on the product's normal photo
     (never a fabricated one) — see attributes.colorImages, set from the upload form's colour picker.
     Every card for this product on the page updates (a product can appear more than once, e.g. Home + search). */
  const p = (typeof allProds !== 'undefined' ? allProds : (window.allProds || [])).find(x => x.id === id) || (window.state && window.state.byId && window.state.byId[id]);
  const linked = p && cardColorPick[id] && window.Pcx && Pcx.Variants ? Pcx.Variants.image(p, cardColorPick[id]) : null;
  document.querySelectorAll(`.pcCtl[data-pid="${id}"]`).forEach(ctl => {
    const img = ctl.closest('.pcard')?.querySelector('.pcImg img');
    if (!img) return;
    if (!img.dataset.origSrc) img.dataset.origSrc = img.src;
    img.src = linked || img.dataset.origSrc;
  });
}

function ctlHTML(id) {
  const it = plainLine(id);
  if (!it) return `<button class="pcAdd" onclick="event.stopPropagation();addToCart(${num(id)},this)">Add to Cart</button>`;
  return `
    <div class="pcStep" onclick="event.stopPropagation()">
      <button class="pcStepB" onclick="event.stopPropagation();cardQty(${num(id)},-1,this)" aria-label="Remove one"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
      <span class="pcStepN">${esc(it.qty)}</span>
      <button class="pcStepB" onclick="event.stopPropagation();cardQty(${num(id)},1,this)" aria-label="Add one"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
    </div>`;
}

/* every card of a product (home grid, rails, category page, storefront ...) follows the cart */
function syncCardCtls() {
  document.querySelectorAll('.pcCtl').forEach(el => {
    const id = Number(el.dataset.pid), it = plainLine(id), q = String(it ? it.qty : 0);
    if (el.dataset.q === q) return;      /* variant products never grow a "plain" line, so this stays Add to Cart */
    el.dataset.q = q;
    el.innerHTML = ctlHTML(id);
  });
}

function cardQty(id, d, src) {
  const it = plainLine(id);
  if (!it) return;
  if (d > 0 && src) flyToCart(src);      /* before the cart updates: the card controls re-render and detach this button */
  it.qty += d;
  if (it.qty <= 0) cart = cart.filter(x => x !== it);
  saveCart(); updateCartBadge();
}

/* TWO card types, deliberately kept distinct (see components/product-card.css):
   cardHTML(p) — the STANDARD product-grid card used by the two-column mobile grids (the Discover feed,
     the in-place category grid, the category page listing, search, storefronts): square photo, 2-line
     name, price + previous price on one line, one compact stock/rating line, real colour swatches and
     Add to Cart.
   cardHTML(p, {compact:true}) — the MERCHANDISING card used in curated horizontal rails (Trending,
     Popular, Top/Hot Deals, Brand Deals, Flash Sales, Featured): no Add to Cart, no stock bar, no
     swatches — just photo, name, price(+previous price), favourite and discount indicators.
   Both share the same data, ids and click-to-open behaviour. */
function compactCardHTML(p) {
  const disc = p.original_price && p.original_price > p.price
    ? Math.round((1 - p.price/p.original_price)*100) : 0;
  const r = ratingMap[p.id];
  return `
    <div class="pcard pcard-compact" onclick="openProduct(${num(p.id)})">
      <div class="pcImg${p.image_url ? ' pcImgPend' : ''}">
        ${p.image_url
          ? `<img src="${safeUrl(p.image_url)}" alt="${esc(p.name)}" loading="lazy" onload="pcImgDone(this)" onerror="pcImgFail(this)">`
          : `<div class="noImgPh">${NO_IMG_SVG(30)}</div>`}
        ${disc > 0 ? `<span class="discBadge">-${disc}%</span>` : ''}
        <button class="favBtn${favs.has(p.id) ? ' on' : ''}" data-fav="${esc(p.id)}" aria-label="Save ${esc(p.name)} to favorites" aria-pressed="${favs.has(p.id)}" onclick="event.stopPropagation();toggleFav(${num(p.id)})">${HEART_SVG}</button>
      </div>
      <div class="pcBody pcBody-compact">
        <div class="pcName">${esc(p.name)}</div>
        <div class="pcPriceRow">
          <span class="pcPrice">${fmt(p.price)}</span>
          ${disc > 0 ? `<span class="pcWas">${fmt(p.original_price)}</span>` : ''}
        </div>
        ${r && r.n > 0 ? `<div class="pcRate">${starsHTML(r.avg, 11)}<span>(${esc(r.n)})</span></div>` : ''}
      </div>
    </div>`;
}

function cardHTML(p, opts) {
  if (opts && opts.compact) return compactCardHTML(p);
  const disc = p.original_price && p.original_price > p.price
    ? Math.round((1 - p.price/p.original_price)*100) : 0;
  const tot = p.max_stock || (p.stock ? p.stock + 15 : 0);
  const pct = tot > 0 ? Math.min(100, Math.round(p.stock/tot*100)) : 0;
  const r = ratingMap[p.id];
  const inCart = plainLine(p.id);
  /* stock bar and rating share ONE compact line instead of two stacked rows (Konga-style density).
     The row is ALWAYS rendered, even with nothing to show — .pcMeta's min-height keeps every card
     in a row the same height regardless of which optional rows a given product happens to have. */

  return `
    <div class="pcard" onclick="openProduct(${num(p.id)})">
      <div class="pcImg${p.image_url ? ' pcImgPend' : ''}">
        ${p.image_url
          ? `<img src="${safeUrl(p.image_url)}" alt="${esc(p.name)}" loading="lazy" onload="pcImgDone(this)" onerror="pcImgFail(this)">`
          : `<div class="noImgPh">${NO_IMG_SVG(36)}</div>`}
        ${disc > 0 ? `<span class="discBadge">-${disc}%</span>` : ''}
        <button class="favBtn${favs.has(p.id) ? ' on' : ''}" data-fav="${esc(p.id)}" aria-label="Save ${esc(p.name)} to favorites" aria-pressed="${favs.has(p.id)}" onclick="event.stopPropagation();toggleFav(${num(p.id)})">${HEART_SVG}</button>
      </div>
      <div class="pcBody">
        <div class="pcName">${esc(p.name)}</div>
        <div class="pcPriceRow">
          <span class="pcPrice">${fmt(p.price)}</span>
          ${disc > 0 ? `<span class="pcWas">${fmt(p.original_price)}</span>` : ''}
        </div>
        <div class="pcMeta">
            ${p.stock > 0 ? `<span class="pcBar"><span class="pcBarFill" style="width:${pct}%"></span></span><span class="pcStockTxt">${esc(p.stock)} left</span>` : ''}
            ${r && r.n > 0 ? `<span class="pcRate">${starsHTML(r.avg, 10)}<span>(${esc(r.n)})</span></span>` : ''}
          </div>
        ${swatchHTML(p)}
        <div class="pcCtl" data-pid="${esc(p.id)}" data-q="${esc(inCart ? inCart.qty : 0)}">${ctlHTML(p.id)}</div>
      </div>
    </div>`;
}
