/* Pcx.StorePage
 * Full-screen public seller storefront, opened via #store=slug (or a vendor id as a
 * fallback for approved vendors from before store_slug existed).
 * Shows the seller's logo, name, description, a verification badge, and their products.
 * Reuses the storefront's own product card through the injected `deps`, same as CategoryPage.
 *
 *   const page = new Pcx.StorePage(document.getElementById('storePage'), {
 *     vendors: () => vendorsMap,          // { id: vendorRow }
 *     products: () => allProds,
 *     cardHTML: p => '<div class="pcard">...',
 *     go: identifier => {},               // navigate to another store (sets location.hash)
 *     onBack: () => {},
 *     onHome: () => {}
 *   });
 *   page.open('ada-fashion-house');  page.close();
 *
 * Needs components/store-page.css.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
  var VERIFIED = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 2.2 3.2-.6.6 3.2L20.4 8 19.8 11l1.4 2.9-2.8 1.6-.6 3.2-3.2-.6L12 20l-2.4-2.2-3.2.6-.6-3.2L3 13.9 4.4 11 3.8 8l2.8-1.6.6-3.2 3.2.6z"/><path d="M9 12.5l2 2 4-4.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

  function StorePage(root, deps) {
    this.root = root;
    this.d = deps;
    this.isOpen = false;
    root.innerHTML =
      '<div class="spg-hdr"><button class="spg-back" type="button" aria-label="Back">' + BACK + '</button>' +
        (deps.onHome ? '<button class="spg-home" type="button" aria-label="Home"><img src="store-logo.png" alt=""></button>' : '') +
        '<div class="spg-title"></div></div>' +
      '<div class="spg-banner"></div>' +
      '<div class="spg-id-wrap">' +
        '<div class="spg-logo"></div>' +
        '<div class="spg-info"><div class="spg-name"></div><div class="spg-meta"></div></div>' +
      '</div>' +
      '<div class="spg-desc"></div>' +
      '<div class="spg-sec"><b class="spg-sect">Products</b><span class="spg-count"></span></div>' +
      '<div class="pgrid-wrap"><div class="pgrid spg-grid"></div></div>';
    var self = this;
    root.querySelector('.spg-back').addEventListener('click', function () { self.d.onBack(); });
    var homeBtn = root.querySelector('.spg-home');
    if (homeBtn) homeBtn.addEventListener('click', function () { self.d.onHome(); });
  }
  var P = StorePage.prototype;

  P.open = function (identifier) {
    var vendors = this.d.vendors();
    var v = vendors[identifier];
    if (!v) {
      var match = Object.keys(vendors).map(function (k) { return vendors[k]; })
        .filter(function (x) { return x.store_slug === identifier; });
      v = match[0];
    }
    var q = function (s) { return this.root.querySelector(s); }.bind(this);

    if (!v || v.status !== 'approved') { this._notFound(); return; }

    q('.spg-title').textContent = v.business_name || 'Store';

    var initial = esc(((v.business_name || '?')[0] || '?').toUpperCase());
    q('.spg-logo').innerHTML = v.logo_url
      ? '<img src="' + esc(v.logo_url) + '" alt="" onerror="this.parentNode.textContent=\'' + initial + '\'">'
      : initial;

    q('.spg-name').innerHTML = esc(v.business_name || 'Store') +
      (v.id_verification_status === 'verified' ? ' <span class="spg-verified" title="Identity verified">' + VERIFIED + '</span>' : '');

    var metaParts = [];
    if (v.city || v.state) metaParts.push([v.city, v.state].filter(Boolean).join(', '));
    q('.spg-meta').textContent = metaParts.join(' \u00b7 ');

    var descEl = q('.spg-desc');
    if (v.store_description) { descEl.textContent = v.store_description; descEl.style.display = ''; }
    else descEl.style.display = 'none';

    var prods = this.d.products().filter(function (p) { return p.vendor_id === v.id; });
    q('.spg-count').textContent = prods.length + ' item' + (prods.length === 1 ? '' : 's');
    q('.spg-grid').innerHTML = prods.length
      ? prods.map(function (p) { return '<div>' + this.d.cardHTML(p) + '</div>'; }, this).join('')
      : '<div class="spg-empty" style="grid-column:1/-1"><h3>No products yet</h3><p>Check back soon.</p></div>';

    this._show();
  };

  P._notFound = function () {
    var q = function (s) { return this.root.querySelector(s); }.bind(this);
    q('.spg-title').textContent = 'Store';
    q('.spg-logo').textContent = '?';
    q('.spg-name').textContent = 'Store not found';
    q('.spg-meta').textContent = '';
    q('.spg-desc').style.display = 'none';
    q('.spg-sec').style.display = 'none';
    q('.spg-grid').innerHTML = '<div class="spg-empty" style="grid-column:1/-1"><h3>This store isn\'t available</h3><p>It may not exist or isn\'t approved yet.</p></div>';
    this._show();
  };

  P._show = function () {
    if (!this.isOpen) { this.isOpen = true; this.root.classList.add('open'); document.body.style.overflow = 'hidden'; }
    this.root.scrollTop = 0;
  };

  P.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    document.body.style.overflow = '';
  };

  Pcx.StorePage = StorePage;
})(window);
