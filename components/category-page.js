/* Pcx.CategoryPage
 * Full-screen category browser opened from the home tiles (#cat=slug, or #cat=all for every main category).
 * Shows a sticky bar of every top-level category (tap one to switch in place, no back-and-forth through
 * "All categories"), a breadcrumb, the subcategories as tiles, optional configurable merchandising sections,
 * and every product in the category and all of its subcategories. Uses the storefront's own product card
 * and ad rendering through the injected `deps` — all of the below except `tree`/`products`/`cardHTML`/`go`/
 * `onBack` are optional, so a host that doesn't pass them (or a test) just gets the plain category browser.
 *
 *   const page = new Pcx.CategoryPage(document.getElementById('catPage'), {
 *     tree: () => catTree,            // Pcx.Categories.Tree (active categories only)
 *     products: () => allProds,
 *     cardHTML: (p, opts) => '<div class="pcard">...',   // opts.compact = merchandising card, no Add to Cart
 *     go: slug => {},                 // navigate to another category (the storefront sets location.hash)
 *     onBack: () => {},
 *     merchSections: cat => [{ key, title, color, products }],  // curated rails shown under the subcategory
 *                                     // tiles for a real category (Trending/Popular/Hot Deals/...); the host
 *                                     // decides what counts and returns [] when there's nothing real to show
 *     ads: () => adsList,             // the storefront's current Ads.list() result
 *     mountAds: root => {}            // the storefront's mountFeedAds — hydrates any .adslot under root
 *   });
 *   page.open('fashion-clothing');  page.open('all');  page.close();
 *   page.openList({ title, crumb, products });   // a plain results page for a given product list (an Explore world's
 *                                               // display category): same header, same grid, same product cards
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
      '<div class="cpg-catbar"></div>' +
      '<div class="cpg-crumbs"></div>' +
      '<div class="cpg-subs"></div>' +
      '<div class="cpg-adgap"></div>' +
      '<div class="cpg-merch"></div>' +
      '<div class="cpg-adgap"></div>' +
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

  /* Every root category, always visible while browsing (sticky bar, screenshot-3 style): tapping one calls
     the same go(slug) as any other tile, which re-renders this same page in place — no navigation, no reload,
     and the shopper never has to go back through "All categories" to reach a different top-level category. */
  P._renderCatBar = function (t, activeCat, showingAll) {
    var q = function (s) { return this.root.querySelector(s); }.bind(this);
    var roots = t.visibleRootsIn(this.d.world || null);
    if (!roots.length) { q('.cpg-catbar').style.display = 'none'; q('.cpg-catbar').innerHTML = ''; return; }
    var activeRootId = activeCat ? (t.path(activeCat.id)[0] || activeCat).id : null;
    q('.cpg-catbar').innerHTML =
      '<a class="cpg-cbtn' + (showingAll ? ' on' : '') + '" data-cat="all">All</a>' +
      roots.map(function (c) {
        return '<a class="cpg-cbtn' + (activeRootId === c.id ? ' on' : '') + '" data-cat="' + esc(c.slug) + '">' + esc(c.name) + '</a>';
      }).join('');
    q('.cpg-catbar').style.display = '';
  };

  /* Ads the admin placed "between curated sections" for this exact page (a specific category, or scope:'all')
     — see data/ads.js Ads.forSlot / admin/ads.js. Two slots: before the merchandising rails, and between them
     and the main grid. Only for a real category (the "All categories" listing has no single category to scope
     an ad to). */
  P._renderAdGaps = function (cat) {
    var gaps = this.root.querySelectorAll('.cpg-adgap');
    var ads = (cat && this.d.ads) ? global.Ads.forSlot(this.d.ads(), { placement: 'section_gap', categoryId: cat.id }) : [];
    for (var i = 0; i < gaps.length; i++) {
      var ad = ads[i];
      gaps[i].innerHTML = ad ? '<div class="adslot au" data-ad="' + esc(ad.id) + '"></div>' : '';
      gaps[i].style.display = ad ? '' : 'none';
    }
    if (this.d.mountAds) this.d.mountAds(this.root);
    if (this.d.observeAllEls) this.d.observeAllEls(this.root.querySelectorAll('.cpg-adgap .au'));
  };

  /* Configurable merchandising rails (Trending/Popular/Hot Deals/Brand Deals/...) under the subcategory tiles.
     The host decides what's eligible and real (see deps.merchSections); this only renders what it's given,
     each with its own header colour so sections read as visually distinct, not identical. Compact cards
     (no Add to Cart) — see components/product-card.js cardHTML(p, {compact:true}). */
  P._renderMerch = function (cat) {
    var q = function (s) { return this.root.querySelector(s); }.bind(this);
    var sections = (cat && this.d.merchSections) ? (this.d.merchSections(cat) || []) : [];
    q('.cpg-merch').innerHTML = sections.map(function (sec) {
      return '<div class="cpg-msec" style="--msec-accent:' + esc(sec.color || '#D91C2D') + '">' +
        '<div class="cpg-msec-hd"><span class="cpg-msec-ttl">' + esc(sec.title) + '</span></div>' +
        '<div class="cpg-msec-scroll">' +
          sec.products.map(function (p) { return '<div class="fcard-wrap au">' + this.d.cardHTML(p, { compact: true }) + '</div>'; }, this).join('') +
        '</div></div>';
    }, this).join('');
    q('.cpg-merch').style.display = sections.length ? '' : 'none';
    if (this.d.observeAllEls) this.d.observeAllEls(this.root.querySelectorAll('.cpg-msec .au'));
  };

  P.open = function (slug) {
    var t = this.d.tree(), q = function (s) { return this.root.querySelector(s); }.bind(this);
    var all = slug === 'all';
    var cat = all ? null : t.bySlug[slug];
    if (!all && (!cat || !t.isVisible(cat.id))) { this._notFound(); return; }

    q('.cpg-title').textContent = all ? 'All categories' : cat.name;
    this._renderCatBar(t, cat, all);

    var crumbs = ['<a data-cat="all">All categories</a>'];
    if (cat) t.path(cat.id).forEach(function (c, i, arr) {
      crumbs.push(i === arr.length - 1 ? '<span>' + esc(c.name) + '</span>' : '<a data-cat="' + esc(c.slug) + '">' + esc(c.name) + '</a>');
    });
    q('.cpg-crumbs').innerHTML = all ? '' : crumbs.join('<span>\u203a</span>');

    var subs = all ? t.visibleRootsIn(this.d.world || null) : t.visibleChildren(cat.id);
    q('.cpg-subs').innerHTML = subs.map(function (c) {
      return '<a class="cpg-tile" data-cat="' + esc(c.slug) + '">' + Pcx.Categories.thumb(t, c, 'round') + '<span class="cpg-name">' + esc(c.name) + '</span></a>';
    }).join('');
    q('.cpg-subs').style.display = subs.length ? '' : 'none';

    this._renderAdGaps(cat);
    this._renderMerch(cat);

    var showProducts = !all;
    q('.cpg-sec').style.display = showProducts ? '' : 'none';
    q('.pgrid-wrap').style.display = showProducts ? '' : 'none';
    if (showProducts) {
      var match = t.productMatcher(cat.id);
      var prods = this.d.products().filter(match);
      q('.cpg-sect').textContent = subs.length ? 'All in ' + cat.name : 'Products';
      q('.cpg-count').textContent = prods.length + ' item' + (prods.length === 1 ? '' : 's');
      if (prods.length) {
        var cells = prods.map(function (p) { return '<div class="au">' + this.d.cardHTML(p) + '</div>'; }, this);
        var feedAds = this.d.ads ? global.Ads.forSlot(this.d.ads(), { placement: 'feed', categoryId: cat.id }) : [];
        if (feedAds.length) cells = global.Ads.interleave(cells, feedAds, 2);
        q('.cpg-grid').innerHTML = cells.join('');
        if (feedAds.length && this.d.mountAds) this.d.mountAds(this.root);
        if (this.d.observeAllEls) this.d.observeAllEls(this.root.querySelectorAll('.cpg-grid .au'));
      } else {
        q('.cpg-grid').innerHTML = '<div class="cpg-empty" style="grid-column:1/-1"><h3>No products here yet</h3><p>Check back soon' + (subs.length ? ' or browse a subcategory above' : '') + '.</p></div>';
      }
    }
    this._show();
  };

  /* Product-results page for a list the caller already computed (no subcategories, no category lookup,
     no catbar/merch/ad gaps — there is no single real category to scope any of that to). */
  P.openList = function (o) {
    var q = function (s) { return this.root.querySelector(s); }.bind(this);
    var prods = o.products || [];
    q('.cpg-title').textContent = o.title || 'Products';
    q('.cpg-catbar').style.display = 'none'; q('.cpg-catbar').innerHTML = '';
    q('.cpg-crumbs').innerHTML = o.crumb ? '<span>' + esc(o.crumb) + '</span><span>\u203a</span><span>' + esc(o.title || '') + '</span>' : '';
    q('.cpg-subs').innerHTML = '';
    q('.cpg-subs').style.display = 'none';
    this.root.querySelectorAll('.cpg-adgap').forEach(function (g) { g.style.display = 'none'; g.innerHTML = ''; });
    q('.cpg-merch').style.display = 'none'; q('.cpg-merch').innerHTML = '';
    q('.cpg-sec').style.display = '';
    q('.pgrid-wrap').style.display = '';
    q('.cpg-sect').textContent = 'Products';
    q('.cpg-count').textContent = prods.length + ' item' + (prods.length === 1 ? '' : 's');
    q('.cpg-grid').innerHTML = prods.length
      ? prods.map(function (p) { return '<div>' + this.d.cardHTML(p) + '</div>'; }, this).join('')
      : '<div class="cpg-empty" style="grid-column:1/-1"><h3>' + esc(o.emptyTitle || 'No products here yet') + '</h3><p>' + esc(o.emptyText || 'Check back soon.') + '</p></div>';
    this._show();
  };

  P._notFound = function () {
    var q = function (s) { return this.root.querySelector(s); }.bind(this);
    q('.cpg-title').textContent = 'Category';
    q('.cpg-catbar').style.display = 'none'; q('.cpg-catbar').innerHTML = '';
    q('.cpg-crumbs').innerHTML = '<a data-cat="all">All categories</a>';
    q('.cpg-subs').style.display = 'none';
    this.root.querySelectorAll('.cpg-adgap').forEach(function (g) { g.style.display = 'none'; g.innerHTML = ''; });
    q('.cpg-merch').style.display = 'none'; q('.cpg-merch').innerHTML = '';
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
