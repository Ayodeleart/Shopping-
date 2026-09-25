/* Pcx.Variants: the colour / size choices a customer makes before buying.
 *
 * NOT a second attribute system. The vendor / admin product form (components/product-attributes.js) already saves
 * `products.attributes`, e.g. { colors: ['Black','Red'], sizes: { system: 'Letter (XS-XXL)', values: ['S','M'] } }.
 * This file only READS that same structure on the customer side: sizes come from Pcx.Fashion.sizeGroups (already used by
 * the product page), colours from attributes.colors. Nothing here writes to the database.
 *
 * A cart line carries its picks as plain fields: { id, qty, ..., size: 'M' | null, color: 'Black' | null }.
 * Two lines are the same line only if id, size and colour all match (see lineKey).
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  function attrs(p) {
    var a = p && p.attributes;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = null; } }
    return a && typeof a === 'object' ? a : {};
  }
  function clean(list) {
    var seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
      var s = String(v == null ? '' : v).trim();
      if (s && !seen[s.toLowerCase()]) { seen[s.toLowerCase()] = 1; out.push(s); }
    });
    return out;
  }

  function colors(p) { return clean(attrs(p).colors); }
  function sizeGroups(p) { return (Pcx.Fashion && Pcx.Fashion.sizeGroups) ? Pcx.Fashion.sizeGroups(p) : []; }

  /* does this product need the customer to choose something before it can be added to the cart? */
  function needsChoice(p) { return colors(p).length > 0 || sizeGroups(p).length > 0; }

  /* two cart lines are one line only when product, size and colour all match */
  function lineKey(x) { return [x && x.id, (x && x.size) || '', (x && x.color) || ''].join('|'); }

  /* "Colour: Black · Size: XL" for the cart, checkout and order screens */
  function label(x) {
    var bits = [];
    if (x && x.color) bits.push('Colour: ' + x.color);
    if (x && x.size) bits.push('Size: ' + x.size);
    return bits.join(' \u00b7 ');
  }

  /* what the server stores on the order line: {"Colour":"Black","Size":"XL"} (null when the product had no options) */
  function payload(x) {
    var o = {};
    if (x && x.color) o.Colour = String(x.color).slice(0, 60);
    if (x && x.size) o.Size = String(x.size).slice(0, 60);
    return Object.keys(o).length ? o : null;
  }

  /* CSS colour for a swatch dot, when product-attributes.js (which owns the colour list) is loaded */
  function swatch(name) {
    var c = Pcx.ProductAttributes && Pcx.ProductAttributes.COLORS;
    return c && c[name] ? c[name] : null;
  }

  /* the photo a vendor/admin linked to a colour (attributes.colorImages), if any — picked from the product's own
     uploaded photos in the upload form (see colorGroup() in product-attributes.js); never a fabricated image */
  function image(p, colorName) {
    var ci = attrs(p).colorImages;
    return (ci && colorName && ci[colorName]) ? ci[colorName] : null;
  }

  Pcx.Variants = { colors: colors, sizeGroups: sizeGroups, needsChoice: needsChoice, lineKey: lineKey, label: label, payload: payload, swatch: swatch, image: image };

  /* ------------------------------------------------------------------------------------------------------------
   * Pcx.VariantSheet — the one bottom sheet used to pick colour/size, from the Home card, search, favourites, or
   * anywhere else a card appears. It never navigates: the caller stays on its page. It doesn't touch the cart itself
   * — it only collects the picks — because each page (index.html, store/store.js) already owns its own cart function
   * (addToCart / cartAdd) with its own currency, product list and cart storage. Fed by Pcx.Variants, same as the
   * product page's inline selectors: one data source, two presentations (a modal here, rows there).
   * ------------------------------------------------------------------------------------------------------------ */
  var sheetEl = null, sheetState = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return (global.fmt ? global.fmt(n) : '\u20a6' + Number(n).toLocaleString('en-NG')); }

  function ensureSheetEl() {
    if (sheetEl) return sheetEl;
    sheetEl = document.createElement('div');
    sheetEl.id = 'variantSheet';
    sheetEl.innerHTML =
      '<div class="vsBg" data-vs-close></div>' +
      '<div class="vsCard" role="dialog" aria-modal="true" aria-label="Choose options">' +
        '<div class="vsGrab"></div>' +
        '<button class="vsClose" data-vs-close aria-label="Close">&times;</button>' +
        '<div class="vsHead">' +
          '<img class="vsImg" alt="">' +
          '<div class="vsHeadTxt"><div class="vsName"></div><div class="vsPrice"></div></div>' +
        '</div>' +
        '<div class="vsBody"></div>' +
        '<div class="vsFoot"><button class="vsAdd" type="button">Add to Cart</button></div>' +
      '</div>';
    document.body.appendChild(sheetEl);
    sheetEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-vs-close]')) closeSheet();
      var chip = e.target.closest('[data-vs-pick]');
      if (chip) pick(chip.dataset.vsGroup, chip.dataset.vsPick);
    });
    sheetEl.querySelector('.vsAdd').addEventListener('click', tryAdd);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheetEl.classList.contains('open')) closeSheet(); });
    return sheetEl;
  }

  function pick(group, value) {
    if (group === 'color') sheetState.color = sheetState.color === value ? null : value;
    else sheetState.size = sheetState.size === value ? null : value;
    var img = sheetState.color ? image(sheetState.product, sheetState.color) : null;
    sheetEl.querySelector('.vsImg').src = img || sheetState.product.image_url || '';
    paintSheet();
  }

  function paintSheet() {
    var p = sheetState.product, groups = sizeGroups(p), cols = colors(p);
    var body = sheetEl.querySelector('.vsBody'), html = '';
    if (cols.length) {
      html += '<div class="vsGroup"><div class="vsGroupLbl">Colour' + (sheetState.color ? ': ' + esc(sheetState.color) : '') + '</div><div class="vsChips">' +
        cols.map(function (c) {
          var sw = swatch(c);
          return '<button type="button" class="vsChip' + (sheetState.color === c ? ' on' : '') + '" data-vs-pick="' + esc(c) + '" data-vs-group="color">' +
            (sw ? '<span class="vsDot" style="background:' + esc(sw) + '"></span>' : '') + esc(c) + '</button>';
        }).join('') + '</div></div>';
    }
    groups.forEach(function (g) {
      var lbl = g.label || 'Size';
      html += '<div class="vsGroup"><div class="vsGroupLbl">' + esc(lbl) + (sheetState.size ? ': ' + esc(sheetState.size) : '') + '</div><div class="vsChips">' +
        (g.values || []).map(function (v) { return '<button type="button" class="vsChip' + (sheetState.size === v ? ' on' : '') + '" data-vs-pick="' + esc(v) + '" data-vs-group="size">' + esc(v) + '</button>'; }).join('') +
        '</div></div>';
    });
    body.innerHTML = html;
    var missing = (cols.length && !sheetState.color) || (groups.length && !sheetState.size);
    sheetEl.querySelector('.vsAdd').textContent = missing ? 'Select ' + (cols.length && !sheetState.color ? 'a colour' : 'a size') + ' to continue' : 'Add to Cart';
    sheetEl.querySelector('.vsAdd').disabled = false; // stays tappable so a forgotten pick re-shows the prompt instead of doing nothing
  }

  function tryAdd() {
    var p = sheetState.product, cols = colors(p), groups = sizeGroups(p);
    if (cols.length && !sheetState.color) return paintSheet();
    if (groups.length && !sheetState.size) return paintSheet();
    var cb = sheetState.onAdd;
    closeSheet();
    if (cb) cb({ size: sheetState.size || null, color: sheetState.color || null });
  }

  /* opts.onAdd(({size, color})) fires once both required picks are made; the caller does the actual cartAdd. */
  function openSheet(product, opts) {
    ensureSheetEl();
    sheetState = { product: product, size: null, color: null, onAdd: (opts && opts.onAdd) || null };
    sheetEl.querySelector('.vsImg').src = product.image_url || '';
    sheetEl.querySelector('.vsName').textContent = product.name || '';
    sheetEl.querySelector('.vsPrice').textContent = money(product.price);
    paintSheet();
    sheetEl.classList.add('open');
    document.documentElement.classList.add('vsLock');
  }
  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.classList.remove('open');
    document.documentElement.classList.remove('vsLock');
  }

  /* Convenience: given a product, either add it straight away (opts.onAdd) or open the sheet — the one entry point
     every "Add to Cart" button (card, search result, favourites) should call. Never navigates. */
  function addWithSheet(product, opts) {
    if (needsChoice(product)) return openSheet(product, opts);
    if (opts && opts.onAdd) opts.onAdd({ size: null, color: null });
  }

  Pcx.VariantSheet = { open: openSheet, close: closeSheet, addWithSheet: addWithSheet };
})(window);
