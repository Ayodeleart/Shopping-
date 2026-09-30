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
 *   - search:          the shared Marcato search page (deps.openSearch), scoped to the Beauty products by the host
 *   - cart / favorites / profile / product page / seller store: the existing global handlers
 *
 * Page order:  hero → categories (2 rows x 5) → merchandising rails → shop by brand → filters → products.
 * There is NO bottom navigation and NO header of its own: the shared world header (components/world-page.js,
 * the same bar every other world uses) sits on top and this module renders underneath it.
 * Product cards are the store's own standard / compact cards (deps.cardHTML) — Beauty has no card of its own.
 *
 *   Pcx.BeautyWorld.mount(root, world, {
 *     onBack: () => {}, cardHTML: (p, opts) => html, brandOf: p => brandRow|null,
 *     sponsored: () => [ads], mountAds: el => {},
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
  var CAT_CAP = 10;                      // subcategory tiles on the page: 2 rows of 5 (See All shows every one)
  var NEW_CAP = 6;                       // New In stops at 6 so a brand-new catalogue still leaves products for the deal rails
  var RAIL_CAP = 10;                     // products per curated rail
  var BRAND_CAP = 20;                    // brands in the Shop by Brand strip
  var NEW_WINDOW_MS = 45 * 24 * 3600 * 1000;   // "New In" = real created_at within the last 45 days (same rule as the home page)
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

  /* ── product card: the store's OWN cards (deps.cardHTML) — never a Beauty-only card ── */

  P._card = function (p, compact) {
    var f = this.d.cardHTML;
    if (typeof f !== 'function') return '';
    return compact ? '<div class="fcard-wrap">' + f(p, { compact: true }) + '</div>' : f(p);
  };

  /* the product's real brand record (brand_id first, then the brand text) — deps.brandOf is the store's own resolver */
  P._brandRow = function (p) {
    var c = this.ctx;
    if (typeof this.d.brandOf === 'function') return this.d.brandOf(p) || null;
    return p.brand_id != null && c.brandById[p.brand_id] ? c.brandById[p.brand_id] : null;
  };

  /* ── curated merchandising rails — REAL data only, no product claimed by two rails, empty rails never drawn ── */

  P._merchSections = function () {
    var self = this, ctx = this.ctx, B = ns.BeautyData, pool = ctx.pool, used = {};
    var take = function (list, cap) {
      var out = list.filter(function (p) { return !used[p.id]; }).slice(0, cap || RAIL_CAP);
      out.forEach(function (p) { used[p.id] = 1; });
      return out;
    };
    var disc = function (p) { return Number(p.original_price) > Number(p.price) ? 1 - Number(p.price) / Number(p.original_price) : 0; };
    var byDisc = function (a, b) { return disc(b) - disc(a); };
    var secs = [];
    var add = function (key, title, color, list) { if (list.length) secs.push({ key: key, title: title, color: color, products: list }); };

    add('deals', "Today's Deals", '#D91C2D', take(pool.filter(function (p) { return p.flash_sale; }).sort(byDisc)));
    var rated = pool.filter(function (p) { return ctx.ratings[p.id] && ctx.ratings[p.id].n > 0; })
      .sort(function (a, b) { return (ctx.ratings[b.id].avg - ctx.ratings[a.id].avg) || (ctx.ratings[b.id].n - ctx.ratings[a.id].n); });
    add('trend', 'Now Trending', '#1E7A46', take(rated));
    /* Best Selling only from real sold units (order_items) — no sales, no rail */
    var sold = function (p) { return (ctx.stats[p.id] && ctx.stats[p.id].sold) || 0; };
    add('best', 'Best Selling', '#B8860B', take(pool.filter(function (p) { return sold(p) > 0; })
      .sort(function (a, b) { return (sold(b) - sold(a)) || byDisc(a, b); })));
    var now = Date.now();
    add('new', 'New In', '#0F6FC5', take(B.sortNewest(pool.filter(function (p) { return p.created_at && (now - new Date(p.created_at).getTime()) < NEW_WINDOW_MS; })), NEW_CAP));
    add('brand', 'Brand Deals', '#D91C6E', take(pool.filter(function (p) { return disc(p) > 0 && self._brandRow(p); }).sort(byDisc)));
    add('disc', 'Discounted Products', '#C0392B', take(pool.filter(function (p) { return disc(p) > 0; }).sort(byDisc)));
    return secs;
  };

  P._railHTML = function (sec) {
    var self = this;
    return '<section class="hSec bw-msec" data-bw-msec="' + esc(sec.key) + '" aria-label="' + esc(sec.title) + '">' +
      '<div class="secHd secHd--accent" style="--sec-accent:' + esc(sec.color) + '"><span class="secTtl">' + esc(sec.title) + '</span></div>' +
      '<div class="hScroll">' + sec.products.map(function (p) { return self._card(p, true); }).join('') + '</div></section>';
  };

  /* Sponsored Products: only genuine sponsored listings (the admin's feed ads), rendered through the store's own ad system */
  P._sponsoredHTML = function () {
    var ads = typeof this.d.sponsored === 'function' ? (this.d.sponsored() || []) : [];
    this._ads = ads;
    if (!ads.length) return '';
    return '<section class="hSec bw-msec" data-bw-msec="sponsored" aria-label="Sponsored Products">' +
      '<div class="secHd secHd--accent" style="--sec-accent:#6B7280"><span class="secTtl">Sponsored Products</span></div>' +
      '<div class="hScroll hScroll--ads">' + ads.map(function (a) { return '<div class="fcard-wrap"><div class="adslot" data-ad="' + esc(a.id) + '"></div></div>'; }).join('') + '</div></section>';
  };

  /* ── Shop by Brand: the shared Pcx.BrandStrip over the Beauty pool (only brands that really have Beauty products) ── */

  P._brandsMount = function () {
    var self = this, host = this.root.querySelector('[data-bw-brands]');
    if (!host || !ns.BrandStrip) return;
    this._strip = ns.BrandStrip.mount(host, {
      products: this.ctx.pool, brandOf: function (p) { return self._brandRow(p); }, cap: BRAND_CAP, className: 'bw-bs',
      onSelect: function (item) {
        if (!item) { self._setFilter({ type: 'all' }, false); return; }
        var rec = null;
        self.ctx.pool.some(function (p) { var b = self._brandRow(p); if (b && ns.BrandStrip.keyOf(p, function (x) { return self._brandRow(x); }) === item.key) { rec = b; return true; } return false; });
        if (rec) self._setFilter({ type: 'brand', brand: rec }, true);     /* same browsing interface: the listing below re-filters in place */
      }
    });
  };

  /* ── build ─────────────────────────────────────────────────────── */

  P._mount = function () {
    var self = this, root = this.root, ctx = this._ctx();
    this.ctx = ctx;
    var B = ns.BeautyData;

    var merch = this._merchSections().map(function (sec) { return self._railHTML(sec); }).join('');
    var sponsored = this._sponsoredHTML();
    var shownCats = ctx.cats.slice(0, CAT_CAP);

    root.innerHTML =
      '<div class="bw-root">' +
        '<div class="bw-bg" aria-hidden="true"><div class="bw-bg-in"><div class="bw-bg-img"></div><div class="bw-bg-veil"></div></div></div>' +

        '<main class="bw-main">' +
          (ctx.promos.length ? this._heroHTML(ctx.promos) : '') +

          (shownCats.length ?
            '<section class="bw-sec" aria-label="Categories">' +
              '<div class="secHd secHd--accent" style="--sec-accent:#D91C6E"><span class="secTtl">Shop by Category</span><button type="button" class="secAll bw-seeall" data-bw="allcats">See All</button></div>' +
              '<div class="bw-catgrid" data-bw-catgrid>' + shownCats.map(function (c) { return self._tileHTML(c); }).join('') + '</div>' +
            '</section>' : '') +

          merch + sponsored +

          '<div data-bw-brands></div>' +

          '<section class="bw-sec bw-all" data-bw-all aria-label="Beauty products">' +
            '<div class="secHd secHd--accent" style="--sec-accent:#0F6FC5"><span class="secTtl" data-bw-title>All Products</span><span class="bw-count" data-bw-count></span></div>' +
            '<div class="bw-chips bw-chips-inline" data-bw-chips-inline>' + this._chipsHTML() + '</div>' +
            '<div class="pgrid-wrap" data-bw-grid></div>' +
          '</section>' +
        '</main>' +

        '<div class="bw-overlay" data-bw-catspage hidden>' +
          '<div class="bw-ov-hdr"><button type="button" class="bw-back" data-bw="closecats" aria-label="Close">' + I.back + '</button><div class="bw-word bw-word-sm">Categories</div></div>' +
          '<div class="bw-ov-body" data-bw-catsgrid></div>' +
        '</div>' +

      '</div>';

    this.el = {};
    var map = { grid: '[data-bw-grid]', count: '[data-bw-count]', title: '[data-bw-title]', allSec: '[data-bw-all]',
      catsPage: '[data-bw-catspage]', catsGrid: '[data-bw-catsgrid]',
      hero: '[data-bw-hero]', track: '[data-bw-track]', dots: '[data-bw-dots]', brands: '[data-bw-brands]' };
    Object.keys(map).forEach(function (k) { self.el[k] = root.querySelector(map[k]); });

    /* the Beauty background: the admin's image, else the built-in one */
    this.root.querySelector('.bw-root').style.setProperty('--bw-bg', 'url("' + String(ctx.bg).replace(/"/g, '%22') + '")');

    this._brandsMount();
    this._heroStart();
    if (this._ads && this._ads.length && typeof this.d.mountAds === 'function') this.d.mountAds(this.root.querySelector('[data-bw-msec="sponsored"]'));

    this._on(root, 'click', function (e) { self._onClick(e); });
    this._on(root, 'keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!self.el.catsPage.hidden) self._closeCats();
    });

    this._applyFilter();
  };

  /* the scroll container that hosts this world (#worldPage) */
  P._scroller = function () { return this.root.closest('#worldPage') || this.root.parentElement; };

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
    if (f.type === 'brand' && f.brand) {
      var self = this;
      return pool.filter(function (p) { var b = self._brandRow(p); return b && String(b.id) === String(f.brand.id); });
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
    if (f.type === 'brand' && f.brand) return f.brand.name;
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
      this.el.grid.innerHTML = '<div class="pgrid">' + shown.map(function (p) { return self._card(p); }).join('') + '</div>' +
        (list.length > shown.length ? '<button type="button" class="bw-more" data-bw="more">Show more</button>' : '');
    }
    this.el.title.textContent = this._filterTitle();
    this.el.count.innerHTML = (this.filter.type === 'cat' || this.filter.type === 'brand')
      ? '<button type="button" class="bw-clear" data-bw="clear">Clear</button> ' + list.length + ' product' + (list.length === 1 ? '' : 's')
      : list.length + ' product' + (list.length === 1 ? '' : 's');
    var chips = this._chipsHTML();
    this.root.querySelectorAll('[data-bw-chips-inline]').forEach(function (el) { el.innerHTML = chips; });
    if (this._strip) {
      var bf = this.filter.type === 'brand' && this.filter.brand ? this.filter.brand : null, key = null;
      if (bf) this.ctx.pool.some(function (p) { var b = self._brandRow(p); if (b && String(b.id) === String(bf.id)) { key = ns.BrandStrip.keyOf(p, function (x) { return self._brandRow(x); }); return true; } return false; });
      this._strip.setActive(key);
    }
    this.root.querySelectorAll('[data-bw-catgrid] .bw-tile').forEach(function (t) {
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
    var top = sec.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 56;   // 52px shared header + a little air
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

  /* ── search: Marcato's ONE shared search page (components/search-page.js), scoped to Beauty by the host ── */

  P._searchOpen = function () {
    if (typeof this.d.openSearch === 'function') this.d.openSearch('beauty');
    else if (global.openSearch) global.openSearch();
  };

  /* ── global actions (existing systems) ────────────────────────── */

  P._onClick = function (ev) {
    var t = ev.target, b = t.closest('[data-bw]');
    if (b) {
      var a = b.getAttribute('data-bw');
      if (a === 'back') { if (this.d.onBack) this.d.onBack(); return; }
      if (a === 'search') { this._searchOpen(); return; }
      if (a === 'allcats') { this._openCats(); return; }
      if (a === 'closecats') { this._closeCats(); return; }
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
  };

  P.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.timer);
    if (this.io) this.io.disconnect();
    this.off.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
    this.off = [];
    this.root.innerHTML = '';
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  ns.BeautyWorld = {
    /* renders into its own child of `root`, so the shared world header already in `root` is never touched */
    mount: function (root, world, deps) {
      var host = global.document.createElement('div');
      host.className = 'bw-host';
      root.appendChild(host);
      return new BeautyWorld(host, world, deps || {});
    }
  };
})(window);
