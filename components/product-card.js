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

/* ── STARS (real ratings only) ────────────────────── */
function starsHTML(avg, px) {
  const pct = Math.max(0, Math.min(100, avg / 5 * 100));
  const star = `<svg width="${esc(px)}" height="${esc(px)}" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const row = star.repeat(5);
  return `<span class="stars" role="img" aria-label="${avg.toFixed(1)} out of 5"><span class="st-bg">${row}</span><span class="st-fg" style="width:${pct}%">${row}</span></span>`;
}

/* ── PRODUCT CARD (JUMIA STYLE) ───────────────────── */
/* Add to Cart turns into a - 1 + stepper once the product is in the cart (see ctlHTML / syncCardCtls). */
/* A product with colours or sizes is never added from its card (a card cannot know which one the customer wants):
   its button opens the product page, where the choices are made (see addToCart in index.html). `needs` = that case. */
function cardNeedsChoice(p) {
  return !!(p && window.Pcx && Pcx.Variants && Pcx.Variants.needsChoice(p));
}
function plainLine(id) { return cart.find(x => x.id === id && !x.size && !x.color); }

function ctlHTML(id, needs) {
  if (needs) return `<button class="pcAdd pcOpts" onclick="event.stopPropagation();openProduct(${num(id)})">Choose options</button>`;
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
    if (el.dataset.need === '1') return;      /* "Choose options" buttons never change with the cart */
    const id = Number(el.dataset.pid), it = plainLine(id), q = String(it ? it.qty : 0);
    if (el.dataset.q === q) return;
    el.dataset.q = q;
    el.innerHTML = ctlHTML(id, false);
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

function cardHTML(p) {
  const disc = p.original_price && p.original_price > p.price
    ? Math.round((1 - p.price/p.original_price)*100) : 0;
  const tot = p.max_stock || (p.stock ? p.stock + 15 : 0);
  const pct = tot > 0 ? Math.min(100, Math.round(p.stock/tot*100)) : 0;
  const r = ratingMap[p.id];
  const needs = cardNeedsChoice(p);
  const inCart = plainLine(p.id);

  return `
    <div class="pcard" onclick="openProduct(${num(p.id)})">
      <div class="pcImg">
        ${p.image_url
          ? `<img src="${safeUrl(p.image_url)}" alt="${esc(p.name)}" loading="lazy">`
          : `<div class="noImgPh"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`}
        ${disc > 0 ? `<span class="discBadge">-${disc}%</span>` : ''}
        <button class="favBtn${favs.has(p.id) ? ' on' : ''}" data-fav="${esc(p.id)}" aria-label="Save ${esc(p.name)} to favorites" aria-pressed="${favs.has(p.id)}" onclick="event.stopPropagation();toggleFav(${num(p.id)})">${HEART_SVG}</button>
      </div>
      <div class="pcBody">
        <div class="pcName">${esc(p.name)}</div>
        <div class="pcPrice">${fmt(p.price)}</div>
        ${disc > 0 ? `<div class="pcWas">${fmt(p.original_price)}</div>` : ''}
        ${r && r.n > 0 ? `<div class="pcRate">${starsHTML(r.avg, 12)}<span>(${esc(r.n)})</span></div>` : ''}
        ${p.stock > 0 ? `
          <div class="pcStockRow">
            <div class="pcBar"><div class="pcBarFill" style="width:${pct}%"></div></div>
            <span class="pcStockTxt">${esc(p.stock)} left</span>
          </div>` : ''}
        <div class="pcCtl" data-pid="${esc(p.id)}" data-need="${needs ? 1 : 0}" data-q="${esc(inCart ? inCart.qty : 0)}">${ctlHTML(p.id, needs)}</div>
      </div>
    </div>`;
}
