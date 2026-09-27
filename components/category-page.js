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
 *     mountAds: root => {},           // the storefront's mountFeedAds — hydrates any .adslot under root
 *     brandLabel: p => 'Nike',        // optional: resolves a product to its brand name for the Filter sheet
 *     ratingOf: p => ({avg,n})        // optional: enables "Popularity" as a Sort option
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
  var SORT_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16.19 2H7.81C4.17 2 2 4.17 2 7.81V16.18C2 19.83 4.17 22 7.81 22H16.18C19.82 22 21.99 19.83 21.99 16.19V7.81C22 4.17 19.83 2 16.19 2ZM13.33 17H10.66C10.25 17 9.91 16.66 9.91 16.25C9.91 15.84 10.25 15.5 10.66 15.5H13.33C13.74 15.5 14.08 15.84 14.08 16.25C14.08 16.66 13.75 17 13.33 17ZM16 12.75H8C7.59 12.75 7.25 12.41 7.25 12C7.25 11.59 7.59 11.25 8 11.25H16C16.41 11.25 16.75 11.59 16.75 12C16.75 12.41 16.41 12.75 16 12.75ZM18 8.5H6C5.59 8.5 5.25 8.16 5.25 7.75C5.25 7.34 5.59 7 6 7H18C18.41 7 18.75 7.34 18.75 7.75C18.75 8.16 18.41 8.5 18 8.5Z" fill="currentColor"/></svg>';
  var FILTER_SVG = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.2673 6.24223C2.20553 4.40955 3.50184 1 6.26039 1H17.7396C20.4981 1 21.7945 4.40955 19.7327 6.24223L15.3356 10.1507C15.1221 10.3405 15 10.6125 15 10.8981V21.0858C15 22.8676 12.8457 23.7599 11.5858 22.5L9.58578 20.5C9.21071 20.1249 8.99999 19.6162 8.99999 19.0858V10.8981C8.99999 10.6125 8.87785 10.3405 8.66436 10.1507L4.2673 6.24223ZM6.26039 3C5.34088 3 4.90877 4.13652 5.59603 4.74741L9.99309 8.6559C10.6336 9.22521 11 10.0412 11 10.8981V19.0858L13 21.0858V10.8981C13 10.0412 13.3664 9.22521 14.0069 8.6559L18.404 4.74741C19.0912 4.13652 18.6591 3 17.7396 3H6.26039Z" fill="currentColor"/></svg>';
  var SORT_OPTS = [['default', 'Recommended'], ['newest', 'Newest'], ['price_asc', 'Price: Low to High'], ['price_desc', 'Price: High to Low'], ['popular', 'Popularity']];

  function CategoryPage(root, deps) {
    this.root = root;
    this.d = deps;
    this.isOpen = false;
    this._ctx = null;                                      // the product list currently browsable (see _renderProductGrid)
    this._sort = 'default';
    this._filter = { brand: '', minPrice: '', maxPrice: '' };
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
      '<div class="pgrid-wrap"><div class="pgrid cpg-grid"></div></div>' +
      '<div class="cpg-sheet-bg" data-sheet-close style="display:none"></div>' +
      '<div class="cpg-sheet" style="display:none"></div>' +
      '<div class="cpg-toolbar" style="display:none">' +
        '<button type="button" class="cpg-tbtn" data-tb="sort">' + SORT_SVG + '<span>Sort by</span></button>' +
        '<span class="cpg-tbsep"></span>' +
        '<button type="button" class="cpg-tbtn" data-tb="filter">' + FILTER_SVG + '<span>Filter by</span><span class="cpg-tbdot" style="display:none"></span></button>' +
      '</div>';
    var self = this;
    root.querySelector('.cpg-back').addEventListener('click', function () { self.d.onBack(); });
    var homeBtn = root.querySelector('.cpg-home');
    if (homeBtn) homeBtn.addEventListener('click', function () { self.d.onHome(); });
    root.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('[data-cat]') : null;
      if (a) { e.preventDefault(); self.d.go(a.getAttribute('data-cat')); return; }

      var tb = e.target.closest('[data-tb]');
      if (tb) { self._openSheet(tb.getAttribute('data-tb')); return; }
      if (e.target.closest('[data-sheet-close]')) { self._closeSheet(); return; }

      var sortBtn = e.target.closest('[data-sort]');
      if (sortBtn) { self._sort = sortBtn.getAttribute('data-sort'); self._closeSheet(); self._renderProductGrid(); return; }

      if (e.target.closest('[data-flt-apply]')) {
        var sel = self.root.querySelector('[data-flt="brand"]'); if (sel) self._filter.brand = sel.value;
        var mn = self.root.querySelector('[data-flt="minPrice"]'); if (mn) self._filter.minPrice = mn.value;
        var mx = self.root.querySelector('[data-flt="maxPrice"]'); if (mx) self._filter.maxPrice = mx.value;
        self._closeSheet(); self._renderProductGrid(); return;
      }
      if (e.target.closest('[data-flt-clear]')) { self._filter = { brand: '', minPrice: '', maxPrice: '' }; self._closeSheet(); self._renderProductGrid(); return; }
    });
  }
  var P = CategoryPage.prototype;

  /* Sticky bottom Sort by / Filter by toolbar for whatever product list is currently browsable (a real
     category's products, or an openList() results page) — filtering/sorting is done client-side over the
     exact same list already computed for this view (no new queries, nothing invented). See _ctx below. */
  P._applyFilters = function (list) {
    var f = this._filter, self = this;
    return list.filter(function (p) {
      if (f.brand && self.d.brandLabel && (self.d.brandLabel(p) || '') !== f.brand) return false;
      if (f.minPrice !== '' && f.minPrice != null && !(Number(p.price) >= Number(f.minPrice))) return false;
      if (f.maxPrice !== '' && f.maxPrice != null && !(Number(p.price) <= Number(f.maxPrice))) return false;
      return true;
    });
  };
  P._applySort = function (list) {
    var s = this._sort, self = this, out = list.slice();
    if (s === 'price_asc') out.sort(function (a, b) { return (a.price || 0) - (b.price || 0); });
    else if (s === 'price_desc') out.sort(function (a, b) { return (b.price || 0) - (a.price || 0); });
    else if (s === 'newest') out.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    else if (s === 'popular' && this.d.ratingOf) out.sort(function (a, b) {
      var ra = self.d.ratingOf(a) || { avg: 0, n: 0 }, rb = self.d.ratingOf(b) || { avg: 0, n: 0 };
      return (rb.avg * Math.log(1 + rb.n)) - (ra.avg * Math.log(1 + ra.n));
    });
    return out;
  };
  P._filterActive = function () { var f = this._filter; return !!(f.brand || f.minPrice !== '' || f.maxPrice !== ''); };

  P._renderProductGrid = function () {
    var ctx = this._ctx, q = function (s) { return this.root.querySelector(s); }.bind(this);
    if (!ctx) return;
    var list = this._applySort(this._applyFilters(ctx.baseProds));
    q('.cpg-count').textContent = list.length + ' item' + (list.length === 1 ? '' : 's') +
      (list.length !== ctx.baseProds.length ? ' (of ' + ctx.baseProds.length + ')' : '');
    if (list.length) {
      var cells = list.map(function (p) { return '<div class="au">' + this.d.cardHTML(p) + '</div>'; }, this);
      var feedAds = (this.d.ads && ctx.cat) ? global.Ads.forSlot(this.d.ads(), { placement: 'feed', categoryId: ctx.cat.id }) : [];
      if (feedAds.length) cells = global.Ads.interleave(cells, feedAds, 2);
      q('.cpg-grid').innerHTML = cells.join('');
      if (feedAds.length && this.d.mountAds) this.d.mountAds(this.root);
      if (this.d.observeAllEls) this.d.observeAllEls(this.root.querySelectorAll('.cpg-grid .au'));
    } else if (!ctx.baseProds.length) {
      q('.cpg-grid').innerHTML = '<div class="cpg-empty" style="grid-column:1/-1"><h3>' + esc(ctx.emptyTitle) + '</h3><p>' + esc(ctx.emptyText) + '</p></div>';
    } else {
      q('.cpg-grid').innerHTML = '<div class="cpg-empty" style="grid-column:1/-1"><h3>No products match those filters</h3><p>Try widening the price range or clearing filters.</p></div>';
    }
    var dot = q('.cpg-tbdot');
    if (dot) dot.style.display = this._filterActive() ? '' : 'none';
  };

  P._showToolbar = function () {
    this.root.querySelector('.cpg-toolbar').style.display = '';
    this.root.classList.add('has-toolbar');
  };
  P._hideToolbar = function () {
    this.root.querySelector('.cpg-toolbar').style.display = 'none';
    this.root.classList.remove('has-toolbar');
    this._closeSheet();
  };
  P._openSheet = function (which) {
    var sheet = this.root.querySelector('.cpg-sheet'), bg = this.root.querySelector('.cpg-sheet-bg');
    sheet.innerHTML = which === 'sort' ? this._sortSheetHTML() : this._filterSheetHTML();
    sheet.style.display = ''; bg.style.display = '';
    requestAnimationFrame(function () { sheet.classList.add('on'); bg.classList.add('on'); });
  };
  P._closeSheet = function () {
    var sheet = this.root.querySelector('.cpg-sheet'), bg = this.root.querySelector('.cpg-sheet-bg');
    if (!sheet) return;
    sheet.classList.remove('on'); bg.classList.remove('on');
    setTimeout(function () { if (!sheet.classList.contains('on')) { sheet.style.display = 'none'; bg.style.display = 'none'; } }, 200);
  };
  P._sortSheetHTML = function () {
    var self = this;
    var opts = SORT_OPTS.filter(function (o) { return o[0] !== 'popular' || self.d.ratingOf; });
    return '<div class="cpg-sheet-hd"><span>Sort by</span><button type="button" class="cpg-sheet-x" data-sheet-close aria-label="Close">&times;</button></div>' +
      '<div class="cpg-sheet-body">' + opts.map(function (o) {
        return '<button type="button" class="cpg-sortopt' + (self._sort === o[0] ? ' on' : '') + '" data-sort="' + o[0] + '">' + esc(o[1]) + (self._sort === o[0] ? ' <span class="cpg-ck">&#10003;</span>' : '') + '</button>';
      }).join('') + '</div>';
  };
  P._filterSheetHTML = function () {
    var self = this, ctx = this._ctx, brands = [];
    if (this.d.brandLabel) {
      var seen = {};
      (ctx ? ctx.baseProds : []).forEach(function (p) { var b = self.d.brandLabel(p); if (b && !seen[b]) { seen[b] = 1; brands.push(b); } });
      brands.sort();
    }
    return '<div class="cpg-sheet-hd"><span>Filter by</span><button type="button" class="cpg-sheet-x" data-sheet-close aria-label="Close">&times;</button></div>' +
      '<div class="cpg-sheet-body">' +
        (brands.length ? '<div class="cpg-fgroup"><label>Brand</label><select data-flt="brand"><option value="">All brands</option>' +
          brands.map(function (b) { return '<option value="' + esc(b) + '"' + (self._filter.brand === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') +
        '</select></div>' : '') +
        '<div class="cpg-fgroup"><label>Price range</label><div class="cpg-frow">' +
          '<input type="number" inputmode="numeric" placeholder="Min" data-flt="minPrice" value="' + esc(this._filter.minPrice || '') + '">' +
          '<span>&ndash;</span>' +
          '<input type="number" inputmode="numeric" placeholder="Max" data-flt="maxPrice" value="' + esc(this._filter.maxPrice || '') + '">' +
        '</div></div>' +
      '</div>' +
      '<div class="cpg-sheet-ft"><button type="button" class="cpg-fclear" data-flt-clear>Clear</button><button type="button" class="cpg-fapply" data-flt-apply>Apply</button></div>';
  };

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
    this._closeSheet();
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
      this._sort = 'default'; this._filter = { brand: '', minPrice: '', maxPrice: '' };
      this._ctx = { cat: cat, baseProds: prods, emptyTitle: 'No products here yet', emptyText: 'Check back soon' + (subs.length ? ' or browse a subcategory above' : '') + '.' };
      this._renderProductGrid();
      this._showToolbar();
    } else {
      this._ctx = null;
      this._hideToolbar();
    }
    this._show();
  };

  /* Product-results page for a list the caller already computed (no subcategories, no category lookup,
     no catbar/merch/ad gaps — there is no single real category to scope any of that to). Same Sort/Filter
     toolbar as a real category page, over this same list. */
  P.openList = function (o) {
    var q = function (s) { return this.root.querySelector(s); }.bind(this);
    this._closeSheet();
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
    this._sort = 'default'; this._filter = { brand: '', minPrice: '', maxPrice: '' };
    this._ctx = { cat: null, baseProds: o.products || [], emptyTitle: o.emptyTitle || 'No products here yet', emptyText: o.emptyText || 'Check back soon.' };
    this._renderProductGrid();
    this._showToolbar();
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
    this._ctx = null;
    this._hideToolbar();
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
