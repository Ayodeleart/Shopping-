/* Pcx.CategoryPage
 * Full-screen category browser opened from the home tiles (#cat=slug, or #cat=all for every main category).
 * Shows a breadcrumb, the subcategories as tiles, and every product in the category and all of its subcategories.
 * Uses the storefront's own product card through the injected `deps`.
 *
 *   const page = new Pcx.CategoryPage(document.getElementById('catPage'), {
 *     tree: () => catTree,            // Pcx.Categories.Tree (active categories only)
 *     products: () => allProds,
 *     cardHTML: p => '<div class="pcard">...',
 *     go: slug => {},                 // navigate to another category (the storefront sets location.hash)
 *     onBack: () => {}
 *   });
 *   page.open('fashion-clothing');  page.open('all');  page.close();
 *
 * Needs data/categories.js and components/categories.css.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};
  var esc = function (s) { return Pcx.Categories.esc(s); };

  var BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';

  function CategoryPage(root, deps) {
    this.root = root;
    this.d = deps;
    this.isOpen = false;
    root.innerHTML =
      '<div class="cpg-hdr"><button class="cpg-back" type="button" aria-label="Back">' + BACK + '</button>' +
        (deps.onHome ? '<button class="cpg-home" type="button" aria-label="Home"><img src="store-logo.png" alt=""></button>' : '') +
        '<div class="cpg-title"></div></div>' +
      '<div class="cpg-crumbs"></div>' +
      '<div class="cpg-subs"></div>' +
      '<div class="cpg-sec"><b class="cpg-sect">Products</b><span class="cpg-count"></span></div>' +
      '<div class="pgrid-wrap"><div class="pgrid cpg-grid"></div></div>';
    var self = this;
    root.querySelector('.cpg-back').addEventListener('click', function () { self.d.onBack(); });
    var homeBtn = root.querySelector('.cpg-home');
    if (homeBtn) homeBtn.addEventListener('click', function () { self.d.onHome(); });
    root.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('[data-cat]') : null;
      if (a) { e.preventDefault(); self.d.go(a.getAttribute('data-cat')); }
    });
  }
  var P = CategoryPage.prototype;

  P.open = function (slug) {
    var t = this.d.tree(), q = function (s) { return this.root.querySelector(s); }.bind(this);
    var all = slug === 'all';
    var cat = all ? null : t.bySlug[slug];
    if (!all && (!cat || !t.isVisible(cat.id))) { this._notFound(); return; }

    q('.cpg-title').textContent = all ? 'All categories' : cat.name;

    var crumbs = ['<a data-cat="all">All categories</a>'];
    if (cat) t.path(cat.id).forEach(function (c, i, arr) {
      crumbs.push(i === arr.length - 1 ? '<span>' + esc(c.name) + '</span>' : '<a data-cat="' + esc(c.slug) + '">' + esc(c.name) + '</a>');
    });
    q('.cpg-crumbs').innerHTML = all ? '' : crumbs.join('<span>\u203a</span>');

    var subs = all ? t.visibleRootsIn(this.d.world || null) : t.visibleChildren(cat.id);
    q('.cpg-subs').innerHTML = subs.map(function (c) {
      return '<a class="cpg-tile" data-cat="' + esc(c.slug) + '">' + Pcx.Categories.thumb(t, c) + '<span class="cpg-name">' + esc(c.name) + '</span></a>';
    }).join('');
    q('.cpg-subs').style.display = subs.length ? '' : 'none';

    var showProducts = !all;
    q('.cpg-sec').style.display = showProducts ? '' : 'none';
    q('.pgrid-wrap').style.display = showProducts ? '' : 'none';
    if (showProducts) {
      var match = t.productMatcher(cat.id);
      var prods = this.d.products().filter(match);
      q('.cpg-sect').textContent = subs.length ? 'All in ' + cat.name : 'Products';
      q('.cpg-count').textContent = prods.length + ' item' + (prods.length === 1 ? '' : 's');
      q('.cpg-grid').innerHTML = prods.length
        ? prods.map(function (p) { return '<div>' + this.d.cardHTML(p) + '</div>'; }, this).join('')
        : '<div class="cpg-empty" style="grid-column:1/-1"><h3>No products here yet</h3><p>Check back soon' + (subs.length ? ' or browse a subcategory above' : '') + '.</p></div>';
    }
    this._show();
  };

  P._notFound = function () {
    var q = function (s) { return this.root.querySelector(s); }.bind(this);
    q('.cpg-title').textContent = 'Category';
    q('.cpg-crumbs').innerHTML = '<a data-cat="all">All categories</a>';
    q('.cpg-subs').style.display = 'none';
    q('.cpg-sec').style.display = 'none';
    q('.pgrid-wrap').style.display = '';
    q('.cpg-grid').innerHTML = '<div class="cpg-empty" style="grid-column:1/-1"><h3>Category not found</h3><p>It may have been moved or hidden.</p></div>';
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

  Pcx.CategoryPage = CategoryPage;
})(window);
