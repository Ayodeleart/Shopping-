/* components/beauty-world.js
 * Pcx.BeautyWorld — the Beauty world (Explore Marcato > Beauty, #world=beauty).
 *
 * It is NOT a separate system. Everything it shows comes from the existing
 * Marcato data:
 *   - products:        the real products filed under the "Beauty" category (the
 *                      same product/category relationship the rest of the store uses)
 *   - categories:      `beauty_categories` rows, each pointing at a real existing
 *                      category (or falling back to honest keyword matching)
 *   - search:          Pcx.Search run over the Beauty product pool
 *   - product cards:   the shared cardHTML (same cart button, heart, seller line)
 *   - product page:    the shared product modal (opened via the existing openProduct)
 *   - cart / favorites / profile: the existing global handlers
 *   - hero:            the shared promotional carousel fed by `beauty_heroes`
 *   - background:      the admin-set Beauty background (beauty_settings)
 *
 * There is no bottom navigation anywhere on this page — the controls live in the
 * sticky glass header (back + title always; filters + search/fav/cart/profile
 * appear once the main search bar scrolls away).
 *
 *   Pcx.BeautyWorld.mount(root, world, {
 *     onBack: () => {},
 *     beauty: { heroes: [...], cats: [...], settings: {background_url, background_enabled}, stats: { [id]: {sold, reviews} } }
 *   })
 *
 * Needs: data/categories.js, data/beauty.js, data/search.js, data/safe.js,
 * data/ads.js, components/product-card.js, components/promotional-carousel.js,
 * components/beauty-world.css. Uses the same globals index.html exposes for the
 * Food world (allProds, catTree, vendorsMap, brandsList, brandById, ratingMap,
 * cardHTML, openProduct, openStore, fmt, esc, safeUrl, safeHref, toast, ...).
 */
(function (global) {
  'use strict';
  var ns = global.Pcx = global.Pcx || {};

  var I = {
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
    heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.3C.4 8 2.3 4.5 5.8 4.1 8 3.8 9.9 5 12 7.2 14.1 5 16 3.8 18.2 4.1c3.5.4 5.4 3.9 3.8 7.6C19.5 16.4 12 21 12 21z"/></svg>',
    bag: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7V6a3 3 0 0 1 6 0v1"/></svg>',
    user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-3.8 4.4-6 8-6s6.8 2.2 8 6"/></svg>',
    arrow: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    sparkle: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/></svg>'
  };

  function esc(s) {
    return global.esc ? global.esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function safeUrl(u) { return global.safeUrl ? global.safeUrl(u) : (u || ''); }
  function num(v) { return global.num ? global.num(v) : Number(v) || 0; }

  function BeautyWorld(root, world, deps) {
    this.root = root;
    this.world = world || { name: 'Beauty' };
    this.d = deps || {};
    this.off = [];
    this.destroyed = false;
    this.filter = { type: 'all' };        // all | new | best | man | woman | kids | cat(row)
    this._mount();
  }

  var P = BeautyWorld.prototype;

  P._on = function (target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.off.push(function () { target.removeEventListener(type, fn, opts); });
  };

  /* ── data context ──────────────────────────────────────────────── */

  P._ctx = function () {
    var B = ns.BeautyData || global.Pcx.BeautyData;
    /* The storefront declares its page data with `let` (never on window), so the
       live values arrive through the world-page deps closure (index.html). The
       window lookups are kept as a fallback for other hosts and the test pages. */
    var beauty = this.d.beauty || {};
    var catTree = beauty.catTree || global.catTree || null;
    var products = beauty.products || global.allProds || [];
    var settings = B ? B.settingsMap(beauty.settings) : {};
    var pool = B ? B.pool(catTree, products) : [];
    var poolSet = new Set(pool.map(function (p) { return p.id; }));
    var ctx = {
      catTree: catTree,
      pool: pool,
      poolSet: poolSet,
      cats: B ? B.activeCats(beauty.cats) : (beauty.cats || []),
      settings: settings,
      bg: B ? B.backgroundUrl(settings) : '',
      promos: B ? B.heroPromos(beauty.heroes) : [],
      stats: beauty.stats || {},
      persons: B ? B.personFilters(catTree) : { man: null, woman: null, kids: null },
      vendors: beauty.vendors || global.vendorsMap || {},
      brands: beauty.brands || global.brandsList || [],
      brandById: beauty.brandById || global.brandById || {},
      ratings: beauty.ratings || global.ratingMap || {},
      fmt: (typeof beauty.fmt === 'function') ? beauty.fmt : (typeof global.fmt === 'function' ? global.fmt : null)
    };
    ctx.scoreOf = function (p) { return B.score(p, ctx.stats); };
    ctx.matchCat = function (row) {
      return B.matchRow(row, {
        catTree: catTree, poolSet: poolSet,
        catNames: catTree ? function (p) { return (catTree.path(p.category_id) || []).map(function (c) { return c.name; }).reverse(); } : null
      });
    };
    return ctx;
  };

  /* The shared card, pointed at the transparent photo when one exists (the
     original photo is never touched — cards elsewhere keep using it). */
  P._card = function (p) {
    var g = global.cardHTML;
    if (!g) return '';
    if (p.beauty_image_url) {
      var copy = {};
      for (var k in p) copy[k] = p[k];
      copy.image_url = p.beauty_image_url;
      return g(copy);
    }
    return g(p);
  };

  /* ── build ─────────────────────────────────────────────────────── */

  P._mount = function () {
    var self = this, root = this.root, B = ns.BeautyData, ctx = this._ctx();
    this.ctx = ctx;

    var catsHTML = ctx.cats.map(function (c, i) { return self._tileHTML(c, i, 'bw-cat'); }).join('');
    var filterChips = self._filterChipsHTML(ctx);
    var newIn = B ? B.sortNewest(ctx.pool).slice(0, 12) : [];
    var grid = this._gridHTML(ctx);

    root.innerHTML =
      '<div class="bw-root">' +
        '<div class="bw-bg" aria-hidden="true"><div class="bw-bg-img"></div><div class="bw-bg-veil"></div></div>' +

        '<header class="bw-hdr">' +
          '<div class="bw-hdr1">' +
            '<button type="button" class="bw-iconbtn bw-back" data-bw="back" aria-label="Back to Explore Marcato">' + I.back + '</button>' +
            '<div class="bw-title">Beauty</div><div class="bw-title-sub">Explore Marcato</div>' +
          '</div>' +
          '<div class="bw-hdr2" data-bw-hdr2>' +
            '<div class="bw-chips">' + filterChips + '</div>' +
            '<div class="bw-tools">' +
              '<button type="button" class="bw-iconbtn" data-bw="search" aria-label="Search Beauty">' + I.search + '</button>' +
              '<button type="button" class="bw-iconbtn" data-bw="favs" aria-label="Favorites">' + I.heart + '</button>' +
              '<button type="button" class="bw-iconbtn" data-bw="cart" aria-label="Cart">' + I.bag + '</button>' +
              '<button type="button" class="bw-iconbtn" data-bw="profile" aria-label="Profile">' + I.user + '</button>' +
            '</div>' +
          '</div>' +
        '</header>' +

        '<div class="bw-search" role="search">' +
          '<button type="button" class="bw-searchbtn" data-bw="search">' + I.search +
            '<span>Search beauty products</span>' +
            '<span class="bw-search-go">Search</span>' +
          '</button>' +
        '</div>' +

        (ctx.promos.length ? '<section class="bw-hero-sec" aria-label="Featured"><div class="bw-hero" data-bw-hero></div></section>' : '') +

        (ctx.cats.length ?
          '<section class="bw-sec" aria-label="Categories">' +
            '<div class="bw-sech"><h2>Categories</h2>' +
              '<button type="button" class="bw-seeall" data-bw="allcats">See All ' + I.arrow + '</button>' +
            '</div>' +
            '<div class="bw-catrail">' + catsHTML + '</div>' +
          '</section>' : '') +

        (newIn.length >= 2 ?
          '<section class="bw-sec" aria-label="New in Beauty">' +
            '<div class="bw-sech"><h2>New In</h2></div>' +
            '<div class="catRowScroll bw-newin">' + newIn.map(function (p) { return '<div class="fcard-wrap">' + self._card(p) + '</div>'; }).join('') + '</div>' +
          '</section>' : '') +

        '<section class="bw-sec bw-all" data-bw-all aria-label="All Beauty products">' +
          '<div class="bw-sech"><h2>All Products</h2><span class="bw-count" data-bw-count></span></div>' +
          '<div class="bw-grid" data-bw-grid>' + grid + '</div>' +
        '</section>' +

        '<div class="bw-space"></div>' +

        '<div class="bw-overlay" data-bw-catspage hidden>' +
          '<div class="bw-ov-hdr">' +
            '<button type="button" class="bw-iconbtn" data-bw="closecats" aria-label="Close">' + I.back + '</button>' +
            '<div class="bw-title">Beauty Categories</div>' +
          '</div>' +
          '<div class="bw-ov-body" data-bw-catsgrid></div>' +
        '</div>' +

        '<div class="bw-overlay" data-bw-spage hidden>' +
          '<div class="bw-sp-hdr">' +
            '<button type="button" class="bw-iconbtn" data-bw="closesearch" aria-label="Close search">' + I.back + '</button>' +
            '<div class="bw-sp-form" role="search">' + I.search +
              '<input class="bw-sp-input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Search beauty products" aria-label="Search beauty products">' +
            '</div>' +
          '</div>' +
          '<div class="bw-sp-body" data-bw-sbody></div>' +
        '</div>' +
      '</div>';

    this.el = {};
    ['hdr2', 'grid', 'count', 'allSec', 'catsPage', 'catsGrid', 'sPage', 'sBody', 'sInput', 'hero'].forEach(function (k) {
      var map = { hdr2: '[data-bw-hdr2]', grid: '[data-bw-grid]', count: '[data-bw-count]', allSec: '[data-bw-all]', catsPage: '[data-bw-catspage]', catsGrid: '[data-bw-catsgrid]', sPage: '[data-bw-spage]', sBody: '[data-bw-sbody]', sInput: '.bw-sp-input', hero: '[data-bw-hero]' };
      self.el[k] = root.querySelector(map[k]);
    });

    /* background image (admin-configured) — the veil keeps text readable */
    if (ctx.bg) this.root.querySelector('.bw-bg-img').style.backgroundImage = 'url("' + ctx.bg + '")';
    this._fitBg();

    /* hero carousel (the shared component; GIFs keep animating) */
    /* the shared hero carousel (window.PromotionalCarousel — see promotional-carousel.js) */
    var CarouselCtor = ns.PromotionalCarousel || global.PromotionalCarousel;
    if (this.el.hero && CarouselCtor && ctx.promos.length) {
      this.carousel = new CarouselCtor(this.el.hero, {
        variant: 'flat',
        interval: 4500,
        ariaLabel: 'Beauty highlights',
        promotions: ctx.promos,
        onSelect: function (event, promo) { self._heroSelect(event, promo); }
      });
    }

    /* sticky filter row: appears once the main search bar scrolls away */
    var scroller = this._scroller();
    if (scroller && 'IntersectionObserver' in global) {
      this.io = new IntersectionObserver(function (entries) {
        var en = entries[0];
        if (!en) return;
        var show = !en.isIntersecting && en.boundingClientRect.top < 0;
        self.el.hdr2.classList.toggle('show', show);
      }, { root: scroller, threshold: 0 });
      this.io.observe(this.root.querySelector('.bw-search'));
    }
    this._on(global, 'resize', function () { self._fitBg(); });

    /* events */
    this._on(root, 'click', function (e) { self._onClick(e); });
    this._on(root, 'keydown', function (e) {
      if (e.key === 'Escape') {
        if (!self.el.sPage.hidden) self._closeSearch();
        else if (!self.el.catsPage.hidden) self.el.catsPage.hidden = true;
      }
    });
    this._on(this.el.sInput, 'input', function () { self._searchType(); });
    this._on(this.el.sInput, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); self._searchSubmit(); } });
    this._on(this.el.sBody, 'click', function (e) { self._searchClick(e); });

    this._applyFilter();
  };

  P._scroller = function () {
    /* #worldPage is the fixed full-screen scroll container that hosts this world */
    var el = this.root, n = this.root;
    while (n && n !== el && n.parentElement) {
      var st = global.getComputedStyle(n);
      if (/(auto|scroll)/.test(st.overflowY)) return n;
      n = n.parentElement;
    }
    return this.root;
  };

  P._fitBg = function () {
    var bg = this.root && this.root.querySelector('.bw-bg');
    if (bg) bg.style.height = (this.root.clientHeight || global.innerHeight || 667) + 'px';
  };

  /* ── chips + tiles ─────────────────────────────────────────────── */

  P._filterChipsHTML = function (ctx) {
    var chips = [
      { key: 'all', label: 'All' },
      { key: 'new', label: 'Newest' },
      { key: 'best', label: 'Popular' }
    ];
    [['man', 'Man'], ['woman', 'Woman'], ['kids', 'Kids']].forEach(function (x) {
      if (ctx.persons[x[0]]) chips.push({ key: x[0], label: x[1] });
    });
    return chips.map(function (c) {
      var on = this.filter.type === c.key;
      return '<button type="button" class="bw-chip' + (on ? ' on' : '') + '" data-bw-filter="' + c.key + '">' + esc(c.label) + '</button>';
    }, this).join('');
  };

  P._tileHTML = function (c, i, extraCls) {
    var letter = esc(String(c.name || '?').trim().charAt(0).toUpperCase());
    var img = c.image_url
      ? '<img class="bw-tile-img" src="' + safeUrl(c.image_url) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">'
      : '<span class="bw-tile-letter">' + letter + '</span>';
    return '<button type="button" class="bw-tile ' + (extraCls || '') + '" data-bw-cat="' + esc(c.id) + '" title="' + esc(c.name) + '">' +
      '<span class="bw-tile-ring">' + img + '</span><span class="bw-tile-label">' + esc(c.name) + '</span></button>';
  };

  P._rowForId = function (id) {
    return this.ctx.cats.find(function (c) { return String(c.id) === String(id); });
  };

  /* ── filtering (real data only) ────────────────────────────────── */

  P._visible = function (ctx) {
    var f = this.filter, pool = ctx.pool;
    if (f.type === 'new') return ns.BeautyData.sortNewest(pool);
    if (f.type === 'best') return ns.BeautyData.sortPopular(pool, ctx.scoreOf);
    if (f.type === 'man' || f.type === 'woman' || f.type === 'kids') {
      var m = ctx.persons[f.type];
      return m ? pool.filter(m) : pool;
    }
    if (f.type === 'cat' && f.row) {
      var match = ctx.matchCat(f.row);
      var list = pool.filter(match);
      if (f.row.kind === 'new') list = ns.BeautyData.sortNewest(list);
      if (f.row.kind === 'best') list = ns.BeautyData.sortPopular(list, ctx.scoreOf);
      return list;
    }
    return pool;
  };

  P._gridHTML = function (ctx) {
    var list = this._visible(ctx);
    if (!ctx.pool.length) return this._emptyHTML('No beauty products yet', 'File products under the <b>Beauty</b> category (Admin &rsaquo; Categories) and they will appear here automatically.');
    if (!list.length) return this._emptyHTML('Nothing here yet', 'No beauty products match this selection right now.');
    return '<div class="bw-grid-inner">' + list.map(function (p) { return '<div class="bw-pc">' + this._card(p) + '</div>'; }, this).join('') + '</div>';
  };

  P._emptyHTML = function (title, msg) {
    return '<div class="bw-empty"><div class="bw-empty-ico">' + I.sparkle + '</div><div class="bw-empty-t">' + esc(title) + '</div><div class="bw-empty-m">' + msg + '</div></div>';
  };

  P._applyFilter = function () {
    var ctx = this.ctx;
    this.el.grid.innerHTML = this._gridHTML(ctx);
    var n = this._visible(ctx).length;
    this.el.count.textContent = n + ' product' + (n === 1 ? '' : 's');
    /* re-mark the active chip */
    this.root.querySelectorAll('[data-bw-filter]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-bw-filter') === this.filter.type && this.filter.type !== 'cat');
    }, this);
  };

  P._setFilter = function (f, scroll) {
    this.filter = f;
    this._applyFilter();
    if (scroll) this.el.allSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── hero destination ──────────────────────────────────────────── */

  P._heroSelect = function (event, promo) {
    event.preventDefault();
    if (!promo || !promo.href) return;
    try {
      var u = new URL(promo.href, global.location.href);
      if (u.origin === global.location.origin && u.pathname === global.location.pathname && u.hash && u.hash !== global.location.hash) {
        global.location.hash = u.hash;      // in-app destination (category / ad / promo page)
        return;
      }
    } catch (e) { /* fall through: let the browser navigate */ }
    global.location.href = safeHref(promo.href);      // other origin / another page
  };

  /* ── categories overlay ────────────────────────────────────────── */

  P._openCats = function () {
    var self = this, ctx = this.ctx;
    var inner = ctx.cats.map(function (c) {
      var count = ctx.pool.length ? ctx.pool.filter(ctx.matchCat(c)).length : 0;
      var meta = c.kind === 'all' ? ctx.pool.length + ' products' : (count + ' product' + (count === 1 ? '' : 's'));
      return '<div class="bw-cpg-item">' + self._tileHTML(c, 0, 'bw-tile-big') +
        '<span class="bw-cpg-count">' + esc(meta) + '</span></div>';
    }).join('');
    this.el.catsGrid.innerHTML = ctx.cats.length
      ? '<div class="bw-cpg">' + inner + '</div>'
      : this._emptyHTML('No categories yet', 'Add Beauty categories in Admin &rsaquo; Banners &rsaquo; Beauty.');
    this.el.catsPage.hidden = false;
    this.el.catsGrid.scrollTop = 0;
    requestAnimationFrame(function () { self.el.catsPage.classList.add('open'); });
  };

  P._closeCats = function () {
    this.el.catsPage.classList.remove('open');
    var self = this;
    setTimeout(function () { self.el.catsPage.hidden = true; }, 220);
  };

  /* ── search overlay ────────────────────────────────────────────── */

  P._searchOpen = function () {
    var self = this;
    this.el.sPage.hidden = false;
    requestAnimationFrame(function () { self.el.sPage.classList.add('open'); self.el.sInput.focus(); });
    this._searchIdle();
  };

  P._closeSearch = function () {
    this.el.sPage.classList.remove('open');
    var self = this;
    setTimeout(function () { self.el.sPage.hidden = true; }, 220);
  };

  P._searchIndex = function () {
    var S = ns.Search;
    if (!S) return null;
    var list = this.ctx.pool;
    var sig = list.length + ':' + (list[0] ? list[0].id : '');
    if (!this._sIdx || this._sSig !== sig) {
      var catTree = this.ctx.catTree, c = this.ctx;
      this._sIdx = S.buildIndex(list, function (p) {
        var b = c.brands ? c.brands.find(function (x) { return String(x.id) === String(p.brand_id); }) : null;
        var names = catTree && p.category_id ? (catTree.path(p.category_id) || []).map(function (c2) { return c2.name; }).reverse() : [];
        return { brand: b ? b.name : p.brand, cats: names, vendor: c.vendors[p.vendor_id] ? c.vendors[p.vendor_id].business_name : '' };
      });
      this._sSig = sig;
    }
    return this._sIdx;
  };

  P._searchIdle = function () {
    var self = this, S = ns.Search, e = esc, html = '', ctx = this.ctx;
    var recent = S ? S.recent.get() : [];
    if (recent.length) {
      html += '<div class="bw-sp-sec"><div class="bw-sp-sech"><b>Recent searches</b></div>' +
        recent.map(function (r) { return '<button type="button" class="bw-sp-recent" data-bw-recent="' + e(r) + '"><span>' + e(r) + '</span></button>'; }).join('') +
        '</div>';
    }
    var cats = ctx.cats.filter(function (c) { return c.kind === 'category'; }).slice(0, 12);
    if (cats.length) {
      html += '<div class="bw-sp-sec"><div class="bw-sp-sech"><b>Browse Beauty</b></div><div class="bw-sp-chips">' +
        cats.map(function (c) { return '<button type="button" class="bw-sp-chip" data-bw-cat="' + esc(c.id) + '">' + e(c.name) + '</button>'; }).join('') +
        '</div></div>';
    }
    this.el.sBody.innerHTML = html || '<div class="bw-sp-hint">Search the real Beauty catalog &mdash; products, by their real name, brand and category.</div>';
    this._searchMode = 'idle';
  };

  P._searchType = function () {
    var self = this, q = (this.el.sInput.value || '').trim();
    if (!q) { this._searchIdle(); return; }
    clearTimeout(this._sTimer);
    this._sTimer = setTimeout(function () { self._searchSuggest(q); }, 100);
  };

  P._searchSuggest = function (q) {
    var self = this, S = ns.Search, e = esc, c = this.ctx;
    if (!S) return;
    var idx = this._searchIndex();
    if (!idx) return;
    this._searchMode = 'suggest'; this._sQ = q;
    var res = S.search(idx, q);
    this._sRes = res;
    var cats = this.ctx.cats.filter(function (c2) { return c2.kind === 'category'; });
    var rankedCats = S.rankNames(cats, q, function (c) { return c.name; }).slice(0, 6);
    var html = '';
    if (rankedCats.length) {
      html += '<div class="bw-sp-sec"><div class="bw-sp-sech"><b>Categories</b></div><div class="bw-sp-chips">' +
        rankedCats.map(function (c) { return '<button type="button" class="bw-sp-chip" data-bw-cat="' + esc(c.id) + '">' + S.highlight(c.name, q) + '</button>'; }).join('') +
        '</div></div>';
    }
    if (res.items.length) {
      var top = res.items.slice(0, 8);
      html += '<div class="bw-sp-sec"><div class="bw-sp-sech"><b>' + (res.partial ? 'Similar products' : 'Products') + '</b></div>' +
        top.map(function (r) {
          var p = r.p, img = p.beauty_image_url || p.image_url;
          var seller = c.vendors[p.vendor_id] ? c.vendors[p.vendor_id].business_name : '';
          return '<button type="button" class="bw-sp-item" data-bw-prod="' + esc(p.id) + '">' +
            (img ? '<img class="bw-sp-img" src="' + safeUrl(img) + '" alt="" loading="lazy" onerror="this.remove()">' : '<span class="bw-sp-img bw-sp-noimg">' + I.search + '</span>') +
            '<span class="bw-sp-itx"><span class="bw-sp-iname">' + S.highlight(p.name, q) + '</span>' +
            (seller ? '<span class="bw-sp-isub">' + e(seller) + '</span>' : '') + '</span>' +
            '<span class="bw-sp-ipc">' + e(c.fmt ? c.fmt(p.price) : num(p.price)) + '</span></button>';
        }).join('') +
        '</div>' +
        '<button type="button" class="bw-sp-seeall" data-bw-seemore>See all ' + res.items.length + ' result' + (res.items.length === 1 ? '' : 's') + ' ' + I.arrow + '</button>';
    } else if (!rankedCats.length) {
      html = '<div class="bw-sp-none"><b>No results for &ldquo;' + e(q) + '&rdquo;</b><span>Check the spelling, or try a shorter word.</span></div>';
    }
    this.el.sBody.innerHTML = html;
  };

  P._searchSubmit = function () {
    var q = (this.el.sInput.value || '').trim();
    if (!q) return;
    this._searchSuggest(q);
    var body = this.el.sBody;
    var more = body.querySelector('[data-bw-seemore]');
    if (more) more.click(); else this.el.sInput.blur();
  };

  P._searchResultsHTML = function () {
    var self = this, S = ns.Search;
    var list = this._sRes.items.map(function (r) { return r.p; });
    if (!list.length) return '<div class="bw-sp-none"><b>No products found</b><span>Try different words or browse the categories.</span></div>';
    return '<div class="bw-sp-count">' + list.length + ' result' + (list.length === 1 ? '' : 's') + ' for &ldquo;' + esc(this._sQ) + '&rdquo;</div>' +
      '<div class="bw-sp-grid">' + list.map(function (p) { return '<div class="bw-pc">' + self._card(p) + '</div>'; }).join('') + '</div>';
  };

  P._searchClick = function (ev) {
    var t = ev.target, el;
    if ((el = t.closest('[data-bw-recent]'))) { this.el.sInput.value = el.getAttribute('data-bw-recent'); this._searchSubmit(); return; }
    if ((el = t.closest('[data-bw-cat]'))) {
      var row = this._rowForId(el.getAttribute('data-bw-cat'));
      if (row) { this._closeSearch(); this._setFilter({ type: 'cat', row: row }, true); }
      return;
    }
    if ((el = t.closest('[data-bw-prod]'))) {
      this._closeSearch();
      if (global.openProduct) global.openProduct(Number(el.getAttribute('data-bw-prod')));
      return;
    }
    if (t.closest('[data-bw-seemore]')) {
      this._searchMode = 'results';
      this.el.sBody.innerHTML = this._searchResultsHTML();
      this.el.sBody.scrollTop = 0;
      return;
    }
    /* tapping a card in the results grid opens the existing product page */
    if (this._searchMode === 'results' && t.closest('.pcard') && !t.closest('.pcCtl, .favBtn')) {
      this._closeSearch();
    }
  };

  /* ── global actions (existing systems) ─────────────────────────── */

  P._onClick = function (ev) {
    var t = ev.target, b = t.closest('[data-bw]');
    if (b) {
      var a = b.getAttribute('data-bw');
      if (a === 'back') { if (this.d.onBack) this.d.onBack(); return; }
      if (a === 'search') { this._searchOpen(); return; }
      if (a === 'favs') {
        /* the existing favorites system lives on the home feed — leave the world and show it */
        if (this.d.onBack) this.d.onBack();
        if (global.showFavorites) global.showFavorites();
        return;
      }
      if (a === 'cart') { if (global.openCart) global.openCart(); return; }
      if (a === 'profile') { if (global.openAccount) global.openAccount(); return; }
      if (a === 'allcats') { this._openCats(); return; }
      if (a === 'closecats') { this._closeCats(); return; }
      if (a === 'closesearch') { this._closeSearch(); return; }
    }
    if ((b = t.closest('[data-bw-filter]'))) {
      this._setFilter({ type: b.getAttribute('data-bw-filter') }, true);
      return;
    }
    if ((b = t.closest('[data-bw-cat]'))) {
      var row = this._rowForId(b.getAttribute('data-bw-cat'));
      if (!row) return;
      if (!this.el.catsPage.hidden) this._closeCats();
      this._setFilter({ type: 'cat', row: row }, true);
    }
  };

  P.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.io) this.io.disconnect();
    if (this.carousel) this.carousel.destroy();
    this.off.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
    this.off = [];
    this.root.innerHTML = '';
  };

  ns.BeautyWorld = {
    mount: function (root, world, deps) {
      root.innerHTML = '';
      var w = new BeautyWorld(root, world, deps || {});
      return w;
    }
  };
})(window);
