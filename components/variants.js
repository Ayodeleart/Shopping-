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

  Pcx.Variants = { colors: colors, sizeGroups: sizeGroups, needsChoice: needsChoice, lineKey: lineKey, label: label, payload: payload, swatch: swatch };
})(window);
