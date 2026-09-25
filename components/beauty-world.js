/* components/beauty-world.js
 * Pcx.BeautyWorld — the Beauty world (Explore Marcato > Beauty, #world=beauty).
 *
 * It is NOT a separate system. Everything it shows comes from the existing
 * Marcato data:
 *   - products:        the real products filed under the "Beauty" category, plus any category a
 *                      Beauty tile is linked to (the same product/category relationship the rest
 *                      of the store uses)
 *   - categories:      `beauty_categories` rows (image / GIF, order, on/off — managed in admin)
 *   - hero:            `beauty_heroes` rows (image / GIF, title, subtitle, button, destination)
 *   - background:      the admin-set Beauty background (`beauty_settings`), else the built-in one
 *   - search:          Pcx.Search (the store's search engine) run over the Beauty products
 *   - cart / favorites / profile / product page / seller store: the existing global handlers
 *
 * Page order:  search → hero → categories → new in → filters → products.
 * There is NO bottom navigation. The Marcato header (back + wordmark) stays on top; once the
 * search bar scrolls away a glass bar slides in under it with the filters and the search /
 * favorites / cart / profile icons.
 *
 *   Pcx.BeautyWorld.mount(root, world, {
 *     onBack: () => {},
 *     beauty: { heroes, cats, settings, stats, catTree, products, vendors, brands, brandById, ratings, fmt }
 *   })
 *
 * Needs: data/beauty.js, data/categories.js, data/search.js, data/safe.js, components/product-card.js
 * (ctlHTML — the shared add-to-cart control), components/beauty-world.css.
 */
(function (global) {
  'use strict';
  var ns = global.Pcx = global.Pcx || {};

  var svg = function (body, s, sw) {
    return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  };
  var I = {
    back: svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>', 22, 2.4),
    search: svg('<circle cx="11" cy="11" r="7.5"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>', 20, 2.2),
    heart: svg('<path d="M12 21s-7.5-4.6-10-9.3C.4 8 2.3 4.5 5.8 4.1 8 3.8 9.9 5 12 7.2 14.1 5 16 3.8 18.2 4.1c3.5.4 5.4 3.9 3.8 7.6C19.5 16.4 12 21 12 21z"/>', 20, 2),
    heartSm: svg('<path d="M12 21s-7.5-4.6-10-9.3C.4 8 2.3 4.5 5.8 4.1 8 3.8 9.9 5 12 7.2 14.1 5 16 3.8 18.2 4.1c3.5.4 5.4 3.9 3.8 7.6C19.5 16.4 12 21 12 21z"/>', 18, 2),
    bag: svg('<path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7V6a3 3 0 0 1 6 0v1"/>', 20, 2),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-3.8 4.4-6 8-6s6.8 2.2 8 6"/>', 20, 2),
    arrow: svg('<polyline points="9 18 15 12 9 6"/>', 13, 2.4),
    sparkle: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/>', 38, 1.6)
  };

  var PAGE = 24;                         // products drawn per step in "All products"
  var FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'new', label: 'Newest' },
    { key: 'best', label: 'Popular' },
    { key: 'man', label: 'Man' },
    { key: 'woman', label: 'Woman' },
    { key: 'kids', label: 'Kids' }
  ];

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
    this.limit = PAGE;
    this._mount();
  }

  var P = BeautyWorld.prototype;

  P._on = function (target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.off.push(function () { target.removeEventListener(type, fn, opts); });
  };

  /* ── data context ──────────────────────────────────────────────── */

  P._ctx = function () {
    var B = ns.BeautyData;
    /* The storefront declares its page data with `let` (never on window), so the live
       values arrive through the world-page deps closure (index.html). */
    var beauty = this.d.beauty || {};
    var catTree = beauty.catTree || null;
    var products = beauty.products || [];
    var settings = B.settingsMap(beauty.settings);
    var linked = B.linkedIds(beauty.cats);
    var pool = B.pool(catTree, products, linked);
    var poolSet = new Set(pool.map(function (p) { return p.id; }));
    var ctx = {
      catTree: catTree, pool: pool, poolSet: poolSet, linked: linked,
      cats: B.activeCats(beauty.cats),
      settings: settings,
      bg: B.backgroundOrDefault(settings),
      promos: B.heroPromos(beauty.heroes),
      stats: beauty.stats || {},
      persons: B.personFilters(catTree, linked),
      vendors: beauty.vendors || {},
      brands: beauty.brands || [],
      brandById: beauty.brandById || {},
      ratings: beauty.ratings || {},
      fmt: (typeof beauty.fmt === 'function') ? beauty.fmt : null
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

  P._money = function (v) { return this.ctx.fmt ? this.ctx.fmt(v) : String(num(v)); };

  /* Brand first (the product's real brand), else the real seller. Never invented. */
  P._byline = function (p) {
    var c = this.ctx, b = p.brand_id != null ? c.brandById[p.brand_id] : null;
    if (b && b.name) return b.name;
    if (p.brand && String(p.brand).trim()) return String(p.brand).trim();
    var v = p.vendor_id != null ? c.vendors[p.vendor_id] : null;
    return v && v.business_name ? v.business_name : '';
  };

  /* ── product card (the store's own cart / favorites / product-page handlers) ── */

  P._card = function (p, cls) {
    var c = this.ctx;
    var cut = !!p.beauty_image_url;
    var img = p.beauty_image_url || p.image_url;
    var by = this._byline(p);
    var was = Number(p.original_price) > Number(p.price) ? Number(p.original_price) : 0;
    var off = was ? Math.round((1 - Number(p.price) / was) * 100) : 0;
    var r = c.ratings[p.id];
    var fav = (typeof favs !== 'undefined' && favs && favs.has && favs.has(p.id)) ? ' on' : '';
    var inCart = (typeof cart !== 'undefined' && cart && cart.find) ? cart.find(function (x) { return x.id === p.id; }) : null;
    var ctl = (typeof global.ctlHTML === 'function') ? global.ctlHTML(p.id) : '';
    return '<article class="bw-card' + (cls ? ' ' + cls : '') + '" data-bw-open="' + esc(p.id) + '">' +
      '<div class="bw-card-img' + (cut ? ' is-cut' : ' is-photo') + '">' +
        (img ? '<img src="' + safeUrl(img) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async" onerror="this.remove()">' : '<span class="bw-card-noimg">' + I.sparkle + '</span>') +
        (off > 0 ? '<span class="bw-card-off">-' + off + '%</span>' : '') +
        '<button type="button" class="favBtn bw-heart' + fav + '" data-fav="' + esc(p.id) + '" aria-label="Save to favorites" onclick="event.stopPropagation();toggleFav(' + num(p.id) + ')">' + I.heartSm + '</button>' +
      '</div>' +
      '<div class="bw-card-body">' +
        '<div class="bw-card-name">' + esc(p.name) + '</div>' +
        (by ? '<div class="bw-card-by">' + esc(by) + '</div>' : '') +
        (r && r.n > 0 ? '<div class="bw-card-rate"><span class="bw-star">&#9733;</span> ' + (Math.round(Number(r.avg) * 10) / 10) + ' <span class="bw-rate-n">(' + esc(r.n) + ')</span></div>' : '') +
        '<div class="bw-card-buy">' +
          '<div class="bw-card-price"><b>' + esc(this._money(p.price)) + '</b>' + (was ? '<s>' + esc(this._money(was)) + '</s>' : '') + '</div>' +
          '<div class="pcCtl bw-ctl" data-pid="' + esc(p.id) + '" data-q="' + esc(inCart ? inCart.qty : 0) + '">' + ctl + '</div>' +
        '</div>' +
      '</div>' +
    '</article>';
  };

  /* ── build ─────────────────────────────────────────────────────── */

  P._mount = function () {
    var self = this, root = this.root, ctx = this._ctx();
    this.ctx = ctx;
    var B = ns.BeautyData;

    var newIn = B.sortNewest(ctx.pool).slice(0, 12);

    root.innerHTML =
      '<div class="bw-root">' +
        '<div class="bw-bg" aria-hidden="true"><div class="bw-bg-in"><div class="bw-bg-img"></div><div class="bw-bg-veil"></div></div></div>' +

        /* Marcato header (back + wordmark, the same bar the other worlds use) + the glass filter/utility bar that slides in under it */
        '<header class="bw-hdr">' +
          '<div class="bw-bar">' +
            '<button type="button" class="bw-back" data-bw="back" aria-label="Back to Explore Marcato">' + I.back + '</button>' +
            '<div class="bw-word">Beauty</div>' +
          '</div>' +
          '<div class="bw-sub" data-bw-sub>' +
            '<div class="bw-chips" data-bw-chips-sticky>' + this._chipsHTML() + '</div>' +
            '<div class="bw-tools">' +
              '<button type="button" class="bw-ico" data-bw="search" aria-label="Search Beauty">' + I.search + '</button>' +
              '<button type="button" class="bw-ico" data-bw="favs" aria-label="Favorites">' + I.heart + '</button>' +
              '<button type="button" class="bw-ico bw-cartbtn" data-bw="cart" aria-label="Cart">' + I.bag + '<span class="bw-dot" data-bw-dot></span></button>' +
              '<button type="button" class="bw-ico" data-bw="profile" aria-label="Account">' + I.user + '</button>' +
            '</div>' +
          '</div>' +
        '</header>' +

        '<main class="bw-main">' +
          '<div class="bw-search" data-bw-search>' +
            '<button type="button" class="bw-searchbtn" data-bw="search">' + I.search + '<span>Search beauty products</span></button>' +
          '</div>' +

          (ctx.promos.length ? this._heroHTML(ctx.promos) : '') +

          (ctx.cats.length ?
            '<section class="bw-sec" aria-label="Categories">' +
              '<div class="bw-sech"><h2>Categories</h2><button type="button" class="bw-seeall" data-bw="allcats">See All ' + I.arrow + '</button></div>' +
              '<div class="bw-catrail" data-bw-catrail>' + ctx.cats.map(function (c) { return self._tileHTML(c); }).join('') + '</div>' +
            '</section>' : '') +

          (newIn.length ?
            '<section class="bw-sec" aria-label="New in Beauty">' +
              '<div class="bw-sech"><h2>New In</h2></div>' +
              '<div class="bw-rail" data-bw-newin>' + newIn.map(function (p) { return self._card(p, 'bw-card-rail'); }).join('') + '</div>' +
            '</section>' : '') +

          '<section class="bw-sec bw-all" data-bw-all aria-label="Beauty products">' +
            '<div class="bw-sech"><h2 data-bw-title>All Products</h2><span class="bw-count" data-bw-count></span></div>' +
            '<div class="bw-chips bw-chips-inline" data-bw-chips-inline>' + this._chipsHTML() + '</div>' +
            '<div class="bw-grid" data-bw-grid></div>' +
          '</section>' +
        '</main>' +

        '<div class="bw-overlay" data-bw-catspage hidden>' +
          '<div class="bw-ov-hdr"><button type="button" class="bw-back" data-bw="closecats" aria-label="Close">' + I.back + '</button><div class="bw-word bw-word-sm">Categories</div></div>' +
          '<div class="bw-ov-body" data-bw-catsgrid></div>' +
        '</div>' +

        '<div class="bw-overlay" data-bw-spage hidden>' +
          '<div class="bw-sp-hdr">' +
            '<button type="button" class="bw-back" data-bw="closesearch" aria-label="Close search">' + I.back + '</button>' +
            '<div class="bw-sp-form" role="search">' + I.search +
              '<input class="bw-sp-input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Search beauty products" aria-label="Search beauty products">' +
            '</div>' +
          '</div>' +
          '<div class="bw-sp-body" data-bw-sbody></div>' +
        '</div>' +
      '</div>';

    this.el = {};
    var map = { sub: '[data-bw-sub]', grid: '[data-bw-grid]', count: '[data-bw-count]', title: '[data-bw-title]', allSec: '[data-bw-all]',
      catsPage: '[data-bw-catspage]', catsGrid: '[data-bw-catsgrid]', sPage: '[data-bw-spage]', sBody: '[data-bw-sbody]',
      sInput: '.bw-sp-input', hero: '[data-bw-hero]', track: '[data-bw-track]', dots: '[data-bw-dots]', search: '[data-bw-search]', dot: '[data-bw-dot]' };
    Object.keys(map).forEach(function (k) { self.el[k] = root.querySelector(map[k]); });

    /* the Beauty background: the admin's image, else the built-in one */
    this.root.querySelector('.bw-root').style.setProperty('--bw-bg', 'url("' + String(ctx.bg).replace(/"/g, '%22') + '")');

    this._heroStart();
    this._watchScroll();
    this._watchCart();

    this._on(root, 'click', function (e) { self._onClick(e); });
    this._on(root, 'keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!self.el.sPage.hidden) self._closeSearch();
      else if (!self.el.catsPage.hidden) self._closeCats();
    });
    this._on(this.el.sInput, 'input', function () { self._searchType(); });
    this._on(this.el.sInput, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); self._searchSubmit(); } });
    this._on(this.el.sBody, 'click', function (e) { self._searchClick(e); });

    this._applyFilter();
  };

  /* the scroll container that hosts this world (#worldPage) */
  P._scroller = function () { return this.root.closest('#worldPage') || this.root.parentElement; };

  /* ── header behaviour: the glass bar appears once the search bar has scrolled away ── */

  P._watchScroll = function () {
    var self = this, sc = this._scroller(), bar = this.root.querySelector('.bw-bar');
    if (!sc) return;
    var update = function () {
      var hb = bar.getBoundingClientRect().bottom, sb = self.el.search.getBoundingClientRect().bottom;
      self.el.sub.classList.toggle('show', sb < hb + 2);
    };
    var raf = 0;
    this._on(sc, 'scroll', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; update(); }); }, { passive: true });
    this._on(global, 'resize', update);
    update();
  };

  /* mirror the store's cart badge on this page's cart icon (no second cart) */
  P._watchCart = function () {
    var self = this, src = global.document.getElementById('cartDot');
    if (!src || !global.MutationObserver) return;
    var sync = function () {
      var n = (src.textContent || '').trim();
      var on = n && n !== '0' && global.getComputedStyle(src).display !== 'none';
      self.el.dot.textContent = on ? n : '';
      self.el.dot.style.display = on ? 'flex' : 'none';
    };
    var mo = new global.MutationObserver(sync);
    mo.observe(src, { childList: true, characterData: true, subtree: true, attributes: true });
    this.off.push(function () { mo.disconnect(); });
    sync();
  };

  /* ── hero: image / GIF slides, auto-advance, swipe (scroll-snap), dots ── */

  P._heroHTML = function (promos) {
    var slides = promos.map(function (h, i) {
      var txt = (h.title || h.meta || h.cta) ?
        '<div class="bw-slide-scrim"></div><div class="bw-slide-txt">' +
          (h.title ? '<h3>' + esc(h.title) + '</h3>' : '') +
          (h.meta ? '<p>' + esc(h.meta) + '</p>' : '') +
          (h.cta ? '<span class="bw-cta">' + I.bag.replace('width="20" height="20"', 'width="16" height="16"') + esc(h.cta) + '</span>' : '') +
        '</div>' : '';
      var img = h.image ? '<img class="bw-slide-img" src="' + safeUrl(h.image) + '" alt="' + esc(h.title || 'Beauty highlight') + '" ' + (i === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + ' decoding="async" draggable="false" onerror="this.remove()">' : '';
      var tag = h.href ? 'a' : 'div';
      return '<' + tag + ' class="bw-slide" data-bw-slide="' + i + '"' + (h.href ? ' href="' + esc(h.href) + '"' : '') + '>' + img + txt + '</' + tag + '>';
    }).join('');
    var dots = promos.length > 1 ? '<div class="bw-dots" data-bw-dots>' + promos.map(function (_, i) {
      return '<button type="button" class="bw-dotb' + (i === 0 ? ' on' : '') + '" data-bw-goto="' + i + '" aria-label="Slide ' + (i + 1) + '"></button>';
    }).join('') + '</div>' : '';
    return '<section class="bw-sec bw-hero-sec" aria-label="Featured"><div class="bw-hero" data-bw-hero><div class="bw-track" data-bw-track>' + slides + '</div>' + dots + '</div></section>';
  };

  P._heroStart = function () {
    var self = this, tr = this.el.track, n = this.ctx.promos.length;
    if (!tr) return;
    this.hi = 0;
    var width = function () { return tr.clientWidth || 1; };
    var mark = function () {
      var i = Math.max(0, Math.min(n - 1, Math.round(tr.scrollLeft / width())));
      self.hi = i;
      if (self.el.dots) [].forEach.call(self.el.dots.children, function (d, k) { d.classList.toggle('on', k === i); });
    };
    var raf = 0;
    this._on(tr, 'scroll', function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; mark(); }); }, { passive: true });
    this._on(tr, 'click', function (e) {
      var s = e.target.closest('[data-bw-slide]');
      if (s && self.ctx.promos[Number(s.getAttribute('data-bw-slide'))]) self._heroSelect(e, self.ctx.promos[Number(s.getAttribute('data-bw-slide'))]);
    });
    if (n < 2) return;
    this._goto = function (i, smooth) {
      i = (i + n) % n;
      tr.scrollTo({ left: i * width(), behavior: smooth === false ? 'auto' : 'smooth' });
    };
    var paused = false, visible = true, hold = 0;
    var pause = function () { paused = true; clearTimeout(hold); hold = setTimeout(function () { paused = false; }, 7000); };
    this._on(tr, 'touchstart', pause, { passive: true });
    this._on(tr, 'pointerdown', pause, { passive: true });
    if ('IntersectionObserver' in global) {
      this.io = new IntersectionObserver(function (en) { visible = !!(en[0] && en[0].isIntersecting); }, { root: this._scroller(), threshold: 0.35 });
      this.io.observe(this.el.hero);
    }
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      this.timer = setInterval(function () {
        if (paused || !visible || global.document.hidden || self.destroyed) return;
        self._goto(self.hi + 1);
      }, 4500);
    }
  };

  P._heroSelect = function (event, promo) {
    if (!promo || !promo.href) { event.preventDefault(); return; }
    try {
      var u = new URL(promo.href, global.location.href);
      if (u.origin === global.location.origin && u.pathname === global.location.pathname && u.hash) {
        event.preventDefault();
        if (u.hash !== global.location.hash) global.location.hash = u.hash;      // in-app destination (category / ad / page)
        return;
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') event.preventDefault();
    } catch (e) { event.preventDefault(); }
    /* any other https link: let the anchor navigate normally */
  };

  /* ── tiles + chips ─────────────────────────────────────────────── */

  P._tileHTML = function (c, big) {
    var letter = esc(String(c.name || '?').trim().charAt(0).toUpperCase());
    var on = this.filter.type === 'cat' && this.filter.row && String(this.filter.row.id) === String(c.id);
    var img = c.image_url
      ? '<img class="bw-tile-img" src="' + safeUrl(c.image_url) + '" alt="" loading="lazy" decoding="async" draggable="false" onerror="this.remove()">'
      : '';
    return '<button type="button" class="bw-tile' + (big ? ' bw-tile-big' : '') + (on ? ' on' : '') + '" data-bw-cat="' + esc(c.id) + '" title="' + esc(c.name) + '">' +
      '<span class="bw-tile-ring"><span class="bw-tile-letter">' + letter + '</span>' + img + '</span><span class="bw-tile-label">' + esc(c.name) + '</span></button>';
  };

  P._chipsHTML = function () {
    var ctx = this.ctx;
    return FILTERS.filter(function (f) { return f.key === 'all' || f.key === 'new' || f.key === 'best' || ctx.persons[f.key]; }).map(function (f) {
      var on = this.filter.type === f.key;
      return '<button type="button" class="bw-chip' + (on ? ' on' : '') + '" data-bw-filter="' + f.key + '">' + esc(f.label) + '</button>';
    }, this).join('');
  };

  P._rowForId = function (id) {
    return this.ctx.cats.find(function (c) { return String(c.id) === String(id); });
  };

  /* ── filtering (real data only) ────────────────────────────────── */

  P._visible = function () {
    var ctx = this.ctx, f = this.filter, pool = ctx.pool, B = ns.BeautyData;
    if (f.type === 'new') return B.sortNewest(pool);
    if (f.type === 'best') return B.sortPopular(pool, ctx.scoreOf);
    if (f.type === 'man' || f.type === 'woman' || f.type === 'kids') {
      var m = ctx.persons[f.type];
      return m ? pool.filter(m) : [];
    }
    if (f.type === 'cat' && f.row) {
      var list = pool.filter(ctx.matchCat(f.row));
      if (f.row.kind === 'new') list = B.sortNewest(list);
      if (f.row.kind === 'best') list = B.sortPopular(list, ctx.scoreOf);
      return list;
    }
    return pool;
  };

  P._emptyHTML = function (title, msg) {
    return '<div class="bw-empty"><div class="bw-empty-ico">' + I.sparkle + '</div><div class="bw-empty-t">' + esc(title) + '</div><div class="bw-empty-m">' + msg + '</div></div>';
  };

  P._filterTitle = function () {
    var f = this.filter;
    if (f.type === 'cat' && f.row) return f.row.name;
    var hit = FILTERS.filter(function (x) { return x.key === f.type; })[0];
    return !hit || hit.key === 'all' ? 'All Products' : hit.label;
  };

  P._applyFilter = function () {
    var ctx = this.ctx, list = this._visible(), self = this;
    var shown = list.slice(0, this.limit);
    if (!ctx.pool.length) {
      this.el.grid.innerHTML = this._emptyHTML('No beauty products yet', 'Products filed under Beauty (or under a category linked to a Beauty tile) will appear here automatically.');
    } else if (!list.length) {
      this.el.grid.innerHTML = this._emptyHTML('Nothing here yet', 'No beauty products match this selection right now.');
    } else {
      this.el.grid.innerHTML = '<div class="bw-grid-inner">' + shown.map(function (p) { return self._card(p); }).join('') + '</div>' +
        (list.length > shown.length ? '<button type="button" class="bw-more" data-bw="more">Show more</button>' : '');
    }
    this.el.title.textContent = this._filterTitle();
    this.el.count.innerHTML = this.filter.type === 'cat'
      ? '<button type="button" class="bw-clear" data-bw="clear">Clear</button> ' + list.length + ' product' + (list.length === 1 ? '' : 's')
      : list.length + ' product' + (list.length === 1 ? '' : 's');
    var chips = this._chipsHTML();
    this.root.querySelectorAll('[data-bw-chips-sticky],[data-bw-chips-inline]').forEach(function (el) { el.innerHTML = chips; });
    this.root.querySelectorAll('[data-bw-catrail] .bw-tile').forEach(function (t) {
      t.classList.toggle('on', self.filter.type === 'cat' && self.filter.row && String(self.filter.row.id) === t.getAttribute('data-bw-cat'));
    });
  };

  P._setFilter = function (f, scroll) {
    this.filter = f;
    this.limit = PAGE;
    this._applyFilter();
    if (scroll) this._scrollToAll();
  };

  P._scrollToAll = function () {
    var sc = this._scroller(), sec = this.el.allSec;
    if (!sc || !sec) return;
    var top = sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 62;
    sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  /* ── categories page ("See All") ───────────────────────────────── */

  P._openCats = function () {
    var self = this, ctx = this.ctx;
    var inner = ctx.cats.map(function (c) {
      var count = ctx.pool.length ? ctx.pool.filter(ctx.matchCat(c)).length : 0;
      var meta = count + ' product' + (count === 1 ? '' : 's');
      return '<div class="bw-cpg-item">' + self._tileHTML(c, true) + '<span class="bw-cpg-count">' + esc(meta) + '</span></div>';
    }).join('');
    this.el.catsGrid.innerHTML = ctx.cats.length ? '<div class="bw-cpg">' + inner + '</div>' : this._emptyHTML('No categories yet', 'Beauty categories are added in the admin dashboard.');
    this.el.catsPage.hidden = false;
    this.el.catsGrid.scrollTop = 0;
    requestAnimationFrame(function () { self.el.catsPage.classList.add('open'); });
  };

  P._closeCats = function () {
    var self = this;
    this.el.catsPage.classList.remove('open');
    setTimeout(function () { if (!self.destroyed) self.el.catsPage.hidden = true; }, 220);
  };

  /* ── search page ───────────────────────────────────────────────── */

  P._searchOpen = function () {
    var self = this;
    this.el.sPage.hidden = false;
    requestAnimationFrame(function () { self.el.sPage.classList.add('open'); self.el.sInput.focus(); });
    this._searchIdle();
  };

  P._closeSearch = function () {
    var self = this;
    this.el.sPage.classList.remove('open');
    this.el.sInput.blur();
    setTimeout(function () { if (!self.destroyed) self.el.sPage.hidden = true; }, 220);
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
      '<div class="bw-grid-inner">' + list.map(function (p) { return self._card(p); }).join('') + '</div>';
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

  /* ── global actions (existing systems) ────────────────────────── */

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
      if (a === 'more') { this.limit += PAGE; this._applyFilter(); return; }
      if (a === 'clear') { this._setFilter({ type: 'all' }, false); return; }
    }
    if ((b = t.closest('[data-bw-goto]'))) { if (this._goto) this._goto(Number(b.getAttribute('data-bw-goto'))); return; }
    if ((b = t.closest('[data-bw-filter]'))) {
      this._setFilter({ type: b.getAttribute('data-bw-filter') }, true);
      return;
    }
    if ((b = t.closest('[data-bw-cat]'))) {
      var row = this._rowForId(b.getAttribute('data-bw-cat'));
      if (!row) return;
      if (!this.el.catsPage.hidden) this._closeCats();
      this._setFilter({ type: 'cat', row: row }, true);
      return;
    }
    /* a product card opens the store's own product page (the heart and cart control handle themselves) */
    if (!t.closest('.favBtn, .pcCtl') && (b = t.closest('[data-bw-open]')) && global.openProduct) {
      global.openProduct(Number(b.getAttribute('data-bw-open')));
    }
  };

  P.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.timer);
    if (this.io) this.io.disconnect();
    this.off.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
    this.off = [];
    this.root.innerHTML = '';
  };

  ns.BeautyWorld = {
    mount: function (root, world, deps) {
      root.innerHTML = '';
      return new BeautyWorld(root, world, deps || {});
    }
  };
})(window);
