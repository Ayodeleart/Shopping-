/* Pcx.SearchPage
 * Full-screen search opened from the search bar / header search icon.
 *
 *   idle      recent searches (tap to run, x to remove, Clear all), browse categories, popular brands
 *   typing    live suggestions: matching brands, categories and products (with the typed words marked)
 *   results   after Enter / "See all": every match with sort, category, brand, price and "on sale" filters
 *
 *   const page = new Pcx.SearchPage(document.getElementById('searchPage'), {
 *     products: () => allProds,
 *     brands: () => brandsList,                       // [{ id, name, logo_url }]
 *     categories: () => [{ title, path, slug }],      // every visible category (any depth)
 *     brandOf: p => brand | null,
 *     catNames: p => ['Fashion', 'Shoes'],            // main category first
 *     vendorName: p => 'Joseph collection',
 *     cardHTML: p => '<div class="pcard">...',
 *     fmt: n => '₦1,000',
 *     onProduct: id => {}, onBrand: id => {}, onCategory: item => {}
 *   });
 *   page.open();  page.open('samsung');  page.close();  page.invalidate();   // call invalidate() when products change
 *
 * Needs data/search.js and components/search-page.css.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};
  var S = function () { return Pcx.Search; };

  var I = {
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
    arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    img: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
  };

  function SearchPage(root, deps) {
    this.root = root;
    this.d = deps;
    this.isOpen = false;
    this.mode = 'idle';
    this.q = '';                 // the query the current suggestions / results are for
    this.res = null;
    this.f = this._freshFilters();
    this.idx = null; this.sig = '';
    this.timer = null;
    this.tab = '';               // '' = everything, else the main category picked in the top tabs
    this._build();
  }
  var P = SearchPage.prototype;

  P._freshFilters = function () { return { sort: 'match', cat: '', brand: '', min: '', max: '', sale: false }; };
  P._esc = function (s) { return S().esc(s); };

  /* ── build ─────────────────────────────────────────── */

  P._build = function () {
    var self = this, root = this.root;
    root.innerHTML =
      '<div class="sp-top">' +
        '<nav class="sp-tabs" role="tablist" aria-label="Search scope"></nav>' +
        '<form class="sp-form" role="search" action="#" novalidate>' +
          '<button type="button" class="sp-back" aria-label="Back">' + I.back + '</button>' +
          '<input class="sp-input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Search products, brands and categories" aria-label="Search">' +
          '<button type="button" class="sp-clear" aria-label="Clear search" hidden>' + I.x + '</button>' +
        '</form>' +
      '</div>' +
      '<div class="sp-body"></div>';
    this.tabsEl = root.querySelector('.sp-tabs');
    this.tabsEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) self._setTab(b.getAttribute('data-tab'));
    });
    this.input = root.querySelector('.sp-input');
    this.clearBtn = root.querySelector('.sp-clear');
    this.body = root.querySelector('.sp-body');

    root.querySelector('.sp-back').addEventListener('click', function () { self.close(); });
    root.querySelector('.sp-form').addEventListener('submit', function (e) { e.preventDefault(); self._submit(self.input.value); });
    this.input.addEventListener('input', function () { self._onType(); });
    this.clearBtn.addEventListener('click', function () { self.input.value = ''; self._onType(); self.input.focus(); });
    this.body.addEventListener('click', function (e) { self._onClick(e); });
    this.body.addEventListener('change', function (e) { self._onFilter(e); });
    this.body.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('input[type="number"][data-f]')) self._onFilter(e); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && self.isOpen) self.close(); });
  };

  /* ── open / close ──────────────────────────────────── */

  P.open = function (query) {
    if (!this.isOpen) {
      this.isOpen = true;
      this.tab = '';
      this._renderTabs();
      this.root.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    if (typeof query === 'string' && query.trim()) { this.input.value = query; this._submit(query); }
    else { this.input.value = ''; this._onType(true); }     // a fresh start: recent searches first
    this.input.focus();          // inside the tap that opened the page, so the phone keyboard comes up
  };

  P.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    this.input.blur();
    document.body.style.overflow = '';
  };

  P.invalidate = function () { this.idx = null; this.sig = ''; };

  /* ── index ─────────────────────────────────────────── */

  P._index = function () {
    var list = this.d.products(), sig = list.length + ':' + (list[0] ? list[0].id : '');
    if (!this.idx || sig !== this.sig) {
      var d = this.d;
      this.idx = S().buildIndex(list, function (p) {
        var b = d.brandOf(p);
        return { brand: b ? b.name : p.brand, cats: d.catNames(p), vendor: d.vendorName(p) };
      });
      this.sig = sig;
    }
    return this.idx;
  };

  /* ── typing ────────────────────────────────────────── */

  P._onType = function (immediate) {
    var self = this, q = this.input.value.trim();
    this.clearBtn.hidden = !this.input.value;
    clearTimeout(this.timer);
    if (!q) { this.mode = 'idle'; this.q = ''; this._renderIdle(); return; }
    var run = function () { self._suggest(q); };
    if (immediate === true) run(); else this.timer = setTimeout(run, 110);
  };

  P._submit = function (raw) {
    var q = String(raw || '').trim();
    if (!q) return;
    this.input.value = q;
    this.clearBtn.hidden = false;
    clearTimeout(this.timer);
    S().recent.add(q);
    this.f = this._freshFilters();
    this.q = q;
    this.res = this._scope(S().search(this._index(), q));
    this.mode = 'results';
    this._renderResults();
    this.input.blur();
    this.body.scrollTop = 0;
  };

  /* ── top tabs: the main categories scope the whole page ─── */

  P._tabList = function () {
    return (this.d.categories() || []).filter(function (c) { return !c.path || c.path.indexOf(' \u203a ') < 0; }).slice(0, 12);
  };

  P._renderTabs = function () {
    var e = this._esc.bind(this), cur = this.tab;
    var list = [{ title: '', label: 'All' }].concat(this._tabList().map(function (c) { return { title: c.title, label: c.title }; }));
    this.tabsEl.innerHTML = list.map(function (t) {
      return '<button type="button" role="tab" class="sp-tab' + (t.title === cur ? ' on' : '') + '" aria-selected="' + (t.title === cur) + '" data-tab="' + e(t.title) + '">' + e(t.label) + '</button>';
    }).join('');
    this.input.placeholder = cur ? 'Search within ' + cur : 'Search products, brands and categories';
    var on = this.tabsEl.querySelector('.on');
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (x) {} }
  };

  P._setTab = function (name) {
    if (name === this.tab) return;
    this.tab = name;
    this._renderTabs();
    var q = this.input.value.trim();
    if (!q) { this.mode = 'idle'; this._renderIdle(); }
    else if (this.mode === 'results') this._submit(q);
    else this._suggest(q);
    this.body.scrollTop = 0;
  };

  P._inTab = function (p) {
    if (!this.tab) return true;
    var n = this.d.catNames(p);
    return n.length > 0 && n[0] === this.tab;
  };

  P._scope = function (res) {
    if (!this.tab) return res;
    var self = this, out = {};
    for (var k in res) out[k] = res[k];
    out.items = res.items.filter(function (r) { return self._inTab(r.p); });
    return out;
  };

  /* ── idle: hot searches + ranked lists (real data only) ─── */

  /* leaf categories of the products, best first; score(p) is 0 for products that do not count */
  P._rank = function (pool, score) {
    var d = this.d, map = {};
    pool.forEach(function (p) {
      var n = d.catNames(p); if (!n.length) return;
      var s = score(p); if (!(s > 0)) return;
      var k = n[n.length - 1], g = map[k] || (map[k] = { name: k, s: 0, img: '', top: -1 });
      g.s += s;
      if (p.image_url && s > g.top) { g.top = s; g.img = p.image_url; }
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.s - a.s || a.name.localeCompare(b.name); }).slice(0, 4);
  };

  P._renderIdle = function () {
    var self = this, e = this._esc.bind(this), d = this.d, html = '';
    var pool = d.products().filter(function (p) { return self._inTab(p); });
    var sold = d.sold || function () { return 0; };

    /* Hot searches: this device's recent searches first, then the categories with the most products */
    var hot = [], seen = {};
    var addHot = function (t) { var k = String(t).toLowerCase(); if (t && !seen[k] && hot.length < 10) { seen[k] = 1; hot.push(t); } };
    S().recent.get().slice(0, 3).forEach(addHot);
    var counts = {};
    pool.forEach(function (p) { var n = d.catNames(p); if (n.length) { var k = n[n.length - 1]; counts[k] = (counts[k] || 0) + 1; } });
    Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); }).forEach(addHot);
    if (hot.length) {
      html += '<div class="sp-hot"><h3>Hot Searches</h3><div class="sp-hotchips">' +
        hot.map(function (t) { return '<button type="button" class="sp-hotchip" data-q="' + e(t) + '">' + e(t) + '</button>'; }).join('') +
        '</div></div>';
    }

    /* Ranked columns */
    var DAY = 86400000, now = Date.now();
    var fresh = pool.filter(function (p) { return p.created_at && now - Date.parse(p.created_at) < 30 * DAY; });
    if (!fresh.length) fresh = pool.slice().filter(function (p) { return p.created_at; })
      .sort(function (a, b) { return Date.parse(b.created_at) - Date.parse(a.created_at); }).slice(0, 40);
    var freshIds = {}; fresh.forEach(function (p) { freshIds[p.id] = 1; });
    var cols = [
      { title: 'Top Searches', rows: this._rank(pool, function (p) { return (sold(p) || 0) * 1000 + 1; }) },
      { title: 'Trending', rows: this._rank(pool, function (p) { return freshIds[p.id] ? 1 : 0; }) },
      { title: 'Deals', rows: this._rank(pool, function (p) { return p.original_price && p.original_price > p.price ? 1 : 0; }) }
    ].filter(function (c) { return c.rows.length; });
    if (cols.length) {
      html += '<div class="sp-cols">' + cols.map(function (c) {
        return '<section class="sp-col"><h3>' + e(c.title) + '</h3>' + c.rows.map(function (r, i) {
          return '<button type="button" class="sp-rrow" data-q="' + e(r.name) + '"><i>' + (i + 1) + '</i>' +
            '<span class="sp-rth">' + (r.img ? '<img src="' + safeUrl(r.img) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>' +
            '<b>' + e(r.name) + '</b></button>';
        }).join('') + '</section>';
      }).join('') + '</div>';
    }
    this.body.innerHTML = html || '<div class="sp-hint">Type what you are looking for. Try a product, a brand or a category.</div>';
    this._browse = [];
  };

  P._logo = function (b) {
    return b.logo_url ? '<img src="' + safeUrl(b.logo_url) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
  };

  /* ── typing: live suggestions ──────────────────────── */

  P._suggest = function (q) {
    var d = this.d, e = this._esc.bind(this), Sx = S();
    this.mode = 'suggest'; this.q = q;
    var res = this._scope(Sx.search(this._index(), q));
    this.res = res;

    var brands = Sx.rankNames(d.brands() || [], q, function (b) { return b.name; }).slice(0, 4);
    var cats = Sx.rankNames(d.categories() || [], q, function (c) { return c.title; }).slice(0, 4);
    this._sugCats = cats;
    var html = '';

    if (brands.length) {
      html += '<div class="sp-sec"><div class="sp-sech"><b>Brands</b></div><div class="sp-chips">' +
        brands.map(function (b) { return '<button type="button" class="sp-chip sp-chip-brand" data-brand="' + esc(b.id) + '">' + this._logo(b) + Sx.highlight(b.name, q) + '</button>'; }, this).join('') + '</div></div>';
    }
    if (cats.length) {
      html += '<div class="sp-sec"><div class="sp-sech"><b>Categories</b></div><div class="sp-chips">' +
        cats.map(function (c, i) { return '<button type="button" class="sp-chip" data-cat="' + i + '" data-scope="sug" title="' + e(c.path || c.title) + '">' + Sx.highlight(c.title, q) + '</button>'; }).join('') + '</div></div>';
    }

    if (res.items.length) {
      var top = res.items.slice(0, 8);
      html += '<div class="sp-sec"><div class="sp-sech"><b>' + (res.partial ? 'Similar products' : 'Products') + '</b></div>' +
        top.map(function (r) {
          var p = r.p, b = d.brandOf(p), names = d.catNames(p), sub = [b ? b.name : (p.brand || ''), names.length ? names[names.length - 1] : ''].filter(Boolean).join(' \u00b7 ');
          return '<button type="button" class="sp-item" data-product="' + esc(p.id) + '">' +
            (p.image_url ? '<img class="sp-item-img" src="' + safeUrl(p.image_url) + '" alt="" loading="lazy">' : '<span class="sp-item-img sp-item-noimg">' + I.img + '</span>') +
            '<span class="sp-item-txt"><span class="sp-item-name">' + Sx.highlight(p.name, q) + '</span>' +
            (sub ? '<span class="sp-item-sub">' + e(sub) + '</span>' : '') +
            '<span class="sp-item-price">' + e(d.fmt(p.price)) + '</span></span></button>';
        }).join('') +
        '</div><button type="button" class="sp-all" data-see-all>See all ' + res.items.length + ' result' + (res.items.length === 1 ? '' : 's') + ' for \u201c' + e(q) + '\u201d ' + I.arrow + '</button>';
    } else if (!brands.length && !cats.length) {
      html += this._noResults(q);
    }
    this.body.innerHTML = html;
  };

  P._noResults = function (q) {
    return '<div class="sp-none"><b>No results for \u201c' + this._esc(q) + '\u201d</b>' +
      '<span>Check the spelling, or try fewer or more general words. You can also browse by category.</span></div>';
  };

  /* ── results ───────────────────────────────────────── */

  P._facet = function (items, fn) {
    var map = {};
    items.forEach(function (r) { var k = fn(r.p); if (k) map[k] = (map[k] || 0) + 1; });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a] || a.localeCompare(b); }).map(function (k) { return { name: k, n: map[k] }; });
  };

  P._filtered = function () {
    var f = this.f, d = this.d;
    var min = parseFloat(f.min), max = parseFloat(f.max);
    var list = this.res.items.filter(function (r) {
      var p = r.p;
      if (f.cat) { var names = d.catNames(p); if (!names.length || names[0] !== f.cat) return false; }
      if (f.brand) { var b = d.brandOf(p); if (((b ? b.name : p.brand) || '') !== f.brand) return false; }
      if (!isNaN(min) && p.price < min) return false;
      if (!isNaN(max) && p.price > max) return false;
      if (f.sale && !(p.original_price && p.original_price > p.price)) return false;
      return true;
    });
    if (f.sort === 'low') list = list.slice().sort(function (a, b) { return a.p.price - b.p.price; });
    else if (f.sort === 'high') list = list.slice().sort(function (a, b) { return b.p.price - a.p.price; });
    else if (f.sort === 'new') list = list.slice().sort(function (a, b) { return (Date.parse(b.p.created_at) || 0) - (Date.parse(a.p.created_at) || 0); });
    return list;
  };

  P._isActive = function () {
    var f = this.f;
    return !!(f.cat || f.brand || f.min || f.max || f.sale || f.sort !== 'match');
  };

  P._renderResults = function () {
    var e = this._esc.bind(this), d = this.d, res = this.res, f = this.f, q = this.q;
    if (!res.items.length) {
      this.body.innerHTML = this._noResults(q);
      this._renderBrowseChipsInto();
      return;
    }
    var cats = this._facet(res.items, function (p) { var n = d.catNames(p); return n.length ? n[0] : ''; });
    var brands = this._facet(res.items, function (p) { var b = d.brandOf(p); return b ? b.name : (p.brand || ''); });

    var sel = function (key, label, opts) {
      return '<label class="sp-sel" data-wrap="' + esc(key) + '"><select data-f="' + esc(key) + '" aria-label="' + e(label) + '">' + opts + '</select></label>';
    };
    var opt = function (v, t, cur) { return '<option value="' + e(v) + '"' + (v === cur ? ' selected' : '') + '>' + e(t) + '</option>'; };

    /* the filter bar is drawn once; changing a filter only redraws the results below it, so typing a price never loses focus */
    this.body.innerHTML = '<div class="sp-filters">' +
      sel('sort', 'Sort', opt('match', 'Best match', f.sort) + opt('low', 'Price: low to high', f.sort) + opt('high', 'Price: high to low', f.sort) + opt('new', 'Newest first', f.sort)) +
      (cats.length > 1 ? sel('cat', 'Category', opt('', 'All categories', f.cat) + cats.map(function (c) { return opt(c.name, c.name + ' (' + c.n + ')', f.cat); }).join('')) : '') +
      (brands.length > 1 ? sel('brand', 'Brand', opt('', 'All brands', f.brand) + brands.map(function (b) { return opt(b.name, b.name + ' (' + b.n + ')', f.brand); }).join('')) : '') +
      '<span class="sp-price" data-wrap="price"><input type="number" inputmode="decimal" min="0" placeholder="Min" data-f="min" value="' + e(f.min) + '" aria-label="Minimum price"><i>-</i><input type="number" inputmode="decimal" min="0" placeholder="Max" data-f="max" value="' + e(f.max) + '" aria-label="Maximum price"></span>' +
      '<label class="sp-toggle" data-wrap="sale"><input type="checkbox" data-f="sale"' + (f.sale ? ' checked' : '') + '>On sale</label>' +
      '<button type="button" class="sp-reset" data-reset hidden>Reset</button>' +
      '</div><div class="sp-out"></div>';
    this._syncControls();
    this._renderOut();
  };

  P._syncControls = function () {
    var f = this.f, root = this.body;
    var mark = function (k, on) { var w = root.querySelector('[data-wrap="' + k + '"]'); if (w) w.classList.toggle('on', !!on); };
    mark('cat', f.cat); mark('brand', f.brand); mark('price', f.min || f.max); mark('sale', f.sale);
    var r = root.querySelector('.sp-reset');
    if (r) r.hidden = !this._isActive();
  };

  P._renderOut = function () {
    var e = this._esc.bind(this), d = this.d, res = this.res, q = this.q;
    var out = this.body.querySelector('.sp-out');
    if (!out) return;
    var list = this._filtered();
    var note = res.partial ? '<div class="sp-note">Nothing matches every word, so these products match some of them.</div>'
      : res.fuzzy ? '<div class="sp-note">Showing close matches for \u201c' + e(q) + '\u201d.</div>' : '';
    var count = list.length === res.items.length
      ? list.length + ' result' + (list.length === 1 ? '' : 's')
      : list.length + ' of ' + res.items.length + ' results';
    var grid = list.length
      ? '<div class="pgrid-wrap"><div class="pgrid">' + list.map(function (r) { return '<div>' + d.cardHTML(r.p) + '</div>'; }).join('') + '</div></div>'
      : '<div class="sp-none"><b>No products match these filters</b><span>Try widening the price range or resetting the filters.</span></div>';
    out.innerHTML = '<div class="sp-count"><b>' + count + '</b> for \u201c' + e(q) + '\u201d</div>' + note + grid;
  };

  P._renderBrowseChipsInto = function () {
    var e = this._esc.bind(this);
    var cats = (this.d.categories() || []).filter(function (c) { return !c.path || c.path.indexOf(' \u203a ') < 0; }).slice(0, 12);
    if (!cats.length) return;
    this._browse = cats;
    this.body.insertAdjacentHTML('beforeend', '<div class="sp-sec"><div class="sp-sech"><b>Browse categories</b></div><div class="sp-chips">' +
      cats.map(function (c, i) { return '<button type="button" class="sp-chip" data-cat="' + i + '" data-scope="browse">' + e(c.title) + '</button>'; }).join('') + '</div></div>');
  };

  /* ── clicks ────────────────────────────────────────── */

  P._onClick = function (ev) {
    var t = ev.target, self = this, d = this.d, el;

    if ((el = t.closest('[data-q]'))) { this._submit(el.getAttribute('data-q')); return; }
    if ((el = t.closest('[data-recent-del]'))) { S().recent.remove(el.getAttribute('data-recent-del')); this._renderIdle(); return; }
    if (t.closest('[data-recent-clear]')) { S().recent.clear(); this._renderIdle(); return; }
    if ((el = t.closest('[data-recent]'))) { this._submit(el.getAttribute('data-recent')); return; }
    if (t.closest('[data-see-all]')) { this._submit(this.q); return; }
    if (t.closest('[data-reset]')) { this.f = this._freshFilters(); this._renderResults(); return; }

    if ((el = t.closest('[data-product]'))) {
      S().recent.add(this.q);
      d.onProduct(Number(el.getAttribute('data-product')));
      return;
    }
    if ((el = t.closest('[data-brand]'))) {
      if (this.q) S().recent.add(this.q);
      this.close(); d.onBrand(Number(el.getAttribute('data-brand')));
      return;
    }
    if ((el = t.closest('[data-cat]'))) {
      var list = el.getAttribute('data-scope') === 'sug' ? this._sugCats : this._browse;
      var item = list && list[Number(el.getAttribute('data-cat'))];
      if (item) { if (this.q) S().recent.add(this.q); this.close(); d.onCategory(item); }
      return;
    }
    /* opening a product from the results grid counts as a search worth remembering */
    if (this.mode === 'results' && t.closest('.pcard') && !t.closest('.pcCtl, .favBtn')) S().recent.add(this.q);
  };

  P._onFilter = function (ev) {
    var el = ev.target.closest('[data-f]');
    if (!el || this.mode !== 'results') return;
    var k = el.getAttribute('data-f');
    this.f[k] = el.type === 'checkbox' ? el.checked : el.value;
    this._syncControls();
    this._renderOut();
  };

  Pcx.SearchPage = SearchPage;
})(window);
