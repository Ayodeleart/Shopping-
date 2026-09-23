/* Pcx.FoodPairingUI
 * Renders "Complete your meal" pairing rows on the product page: each real suggested
 * product gets an image, name, price and a [-] qty [+] stepper (qty starts at 0, never
 * negative). Nothing is added to the cart here — index.html's own Add to Cart / Buy Now
 * reads getSelections() at the moment the customer commits, and calls the EXISTING
 * cartAdd() for the main product and for each selected pairing. This component owns
 * only the local "what's on my tray right now" state and the running total display.
 *
 *   const ui = new Pcx.FoodPairingUI(containerEl, { fmt, esc });
 *   ui.render(suggestions, mainProduct);      // suggestions = Pcx.FoodPairings.suggestionsFor(...)
 *   ui.getSelections();                       // -> [{ product, qty }] for qty > 0
 *   ui.getSelectedTotal();                    // -> sum(price * qty) of current selections
 *   ui.onChange(fn)                           // fn() called whenever a quantity changes
 *   ui.reset();                               // clears selections (called when the product page opens a new product)
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  function FoodPairingUI(root, deps) {
    this.root = root;
    this.d = deps || {};
    this.qty = {};        // productId -> qty
    this.byId = {};       // productId -> product, for the currently rendered set
    this._onChange = null;
  }
  var P = FoodPairingUI.prototype;

  P.onChange = function (fn) { this._onChange = fn; };

  P.reset = function () { this.qty = {}; this.root.style.display = 'none'; this.root.innerHTML = ''; };

  P.getSelections = function () {
    var self = this, out = [];
    Object.keys(this.qty).forEach(function (id) {
      var q = self.qty[id];
      if (q > 0 && self.byId[id]) out.push({ product: self.byId[id], qty: q });
    });
    return out;
  };

  P.getSelectedTotal = function () {
    return this.getSelections().reduce(function (s, x) { return s + x.product.price * x.qty; }, 0);
  };

  P.render = function (suggestions, mainProduct) {
    var self = this, d = this.d, esc = d.esc, fmt = d.fmt;
    this.qty = {}; this.byId = {};
    if (!suggestions || !suggestions.length) { this.root.style.display = 'none'; this.root.innerHTML = ''; return; }

    suggestions.forEach(function (s) { self.byId[s.product.id] = s.product; self.qty[s.product.id] = 0; });

    this.root.innerHTML =
      '<div class="pPairingHd">Complete your meal</div>' +
      '<div class="pPairingSub">Pairs well with ' + esc(mainProduct.name) + '</div>' +
      '<div class="pPairList">' + suggestions.map(function (s) { return self._rowHTML(s.product); }).join('') + '</div>' +
      '<div class="pPairTotalRow"><span>Selected extras</span><b id="pPairExtrasTotal">' + fmt(0) + '</b></div>';

    this.root.style.display = '';
    this.root.querySelectorAll('[data-pair-minus]').forEach(function (btn) {
      btn.addEventListener('click', function () { self._change(Number(btn.dataset.pairMinus), -1); });
    });
    this.root.querySelectorAll('[data-pair-plus]').forEach(function (btn) {
      btn.addEventListener('click', function () { self._change(Number(btn.dataset.pairPlus), 1); });
    });
  };

  P._rowHTML = function (p) {
    var esc = this.d.esc, fmt = this.d.fmt, safeUrl = global.safeUrl || esc;
    return (
      '<div class="pPairRow" data-pair-row="' + p.id + '">' +
        '<div class="pPairImg">' + (p.image_url ? '<img src="' + safeUrl(p.image_url) + '" alt="" loading="lazy">' : '') + '</div>' +
        '<div class="pPairInfo"><div class="pPairName">' + esc(p.name) + '</div><div class="pPairPrice">' + fmt(p.price) + '</div></div>' +
        '<div class="pPairQty">' +
          '<button type="button" data-pair-minus="' + p.id + '" aria-label="Remove one ' + esc(p.name) + '">&minus;</button>' +
          '<b data-pair-n="' + p.id + '">0</b>' +
          '<button type="button" data-pair-plus="' + p.id + '" aria-label="Add one ' + esc(p.name) + '">+</button>' +
        '</div>' +
      '</div>'
    );
  };

  P._change = function (id, delta) {
    var q = Math.max(0, Math.min(20, (this.qty[id] || 0) + delta));
    this.qty[id] = q;
    var n = this.root.querySelector('[data-pair-n="' + id + '"]');
    if (n) n.textContent = String(q);
    var totalEl = this.root.querySelector('#pPairExtrasTotal');
    if (totalEl) totalEl.textContent = this.d.fmt(this.getSelectedTotal());
    if (this._onChange) this._onChange();
  };

  (global.Pcx = global.Pcx || {}).FoodPairingUI = FoodPairingUI;
})(window);
