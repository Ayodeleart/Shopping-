/* Pcx.FoodWorld
 * The real #world=food experience (see components/world-page.js, which delegates to
 * this module only for the 'food' slug — every other world keeps its coming-soon page).
 *
 * Deliberately reuses, rather than re-implements:
 *   - allProds / vendorsMap / catTree (already loaded once at boot by index.html)
 *   - cardHTML() from components/product-card.js for every product card
 *   - openStore() / openProduct() for restaurant profiles and product detail+cart+checkout
 *   - Pcx.Search (data/search.js) for the search bar
 * No network calls of its own, no new tables, no second cart.
 *
 *   Pcx.FoodWorld.mount(rootEl, world, { onBack });
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  function esc(v) {
    var f = global.esc;
    if (f) return f(v);
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  /* safeUrl/safeHref come from data/safe.js (loaded before this file); this is only a
     fallback for the unlikely case this module is ever used on a page that doesn't load it. */
  function safeUrl(v) { return global.safeUrl ? global.safeUrl(v) : esc(v); }
  function safeHref(v) { return global.safeHref ? global.safeHref(v) : String(v || ''); }

  /* ---------------------------------------------------------------- helpers */

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function foodRoot() {
    var ct = global.catTree;
    return ct && ct.bySlug ? ct.bySlug.food : null;
  }

  function foodProductsList() {
    var ct = global.catTree, root = foodRoot();
    if (!ct || !root) return [];
    var match = ct.productMatcher(root.id);
    return (global.allProds || []).filter(match);
  }

  function catText(p) {
    var ct = global.catTree;
    if (ct && p.category_id != null && ct.byId[p.category_id]) return ct.label(p.category_id, ' ').toLowerCase();
    return String(p.category || '').toLowerCase();
  }
  function productHay(p) { return (String(p.name || '') + ' ' + catText(p) + ' ' + String(p.description || '')).toLowerCase(); }

  function vendorOf(p) { return p.vendor_id ? global.vendorsMap[p.vendor_id] : null; }

  /* eligible restaurants: approved vendors (vendorsMap is already approved-only) with >=1 real food product */
  function eligibleRestaurants(foodProds) {
    var byVendor = {};
    foodProds.forEach(function (p) {
      if (!p.vendor_id || !global.vendorsMap[p.vendor_id]) return;
      (byVendor[p.vendor_id] = byVendor[p.vendor_id] || []).push(p);
    });
    return Object.keys(byVendor).map(function (id) {
      return { vendor: global.vendorsMap[id], products: byVendor[id] };
    });
  }

  /* ---------------------------------------------------------------- dominant-colour accent
     Best-effort only: canvas sampling can fail silently (cross-origin image without CORS
     headers). On failure the section header just keeps the default red accent. */
  function accentFor(imgUrl, cb) {
    if (!imgUrl) return cb(null);
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = 8; c.height = 8;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 8, 8);
        var d = ctx.getImageData(0, 0, 8, 8).data, r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
        cb('rgb(' + r + ',' + g + ',' + b + ')');
      } catch (e) { cb(null); }
    };
    img.onerror = function () { cb(null); };
    img.src = safeHref(imgUrl);
  }

  /* ---------------------------------------------------------------- section builders */

  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function cardsHTML(list) { return list.map(function (p) { return '<div>' + global.cardHTML(p) + '</div>'; }).join(''); }

  function vendorCardHTML(v) {
    var letter = esc((v.business_name || '?')[0].toUpperCase());
    return '<div class="fw-vcard" data-open-store="' + esc(v.store_slug || v.id) + '">' +
      '<div class="fw-vlogo">' + (v.logo_url ? '<img src="' + safeUrl(v.logo_url) + '" alt="" loading="lazy" onerror="this.parentNode.textContent=\'' + letter + '\'">' : letter) + '</div>' +
      '<div class="fw-vname">' + esc(v.business_name || '') + '</div>' +
      '</div>';
  }

  function wireVendorCards(scope) {
    scope.querySelectorAll('[data-open-store]').forEach(function (el) {
      el.addEventListener('click', function () { global.openStore(el.dataset.openStore); });
    });
  }

  function renderSearch(root, foodProds, restaurants) {
    var wrap = h('div', 'fw-search',
      '<input type="search" id="fwSearchInput" placeholder="Search food, restaurants..." autocomplete="off">' +
      '<div id="fwSearchResults"></div>');
    root.appendChild(wrap);
    var input = wrap.querySelector('#fwSearchInput'), resEl = wrap.querySelector('#fwSearchResults');
    var idx = null, timer;
    function ensureIndex() {
      if (!idx && global.Pcx && global.Pcx.Search) {
        idx = global.Pcx.Search.buildIndex(foodProds, function (p) {
          var v = vendorOf(p);
          return { brand: '', cats: [catText(p)], vendor: v ? v.business_name : '' };
        });
      }
      return idx;
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (!q) { resEl.innerHTML = ''; resEl.style.display = 'none'; return; }
      timer = setTimeout(function () {
        var Sx = global.Pcx && global.Pcx.Search;
        if (!Sx) return;
        var res = Sx.search(ensureIndex(), q);
        var matchedVendors = Sx.rankNames(restaurants.map(function (r) { return r.vendor; }), q, function (v) { return v.business_name; }).slice(0, 6);
        var html = '';
        if (matchedVendors.length) {
          html += '<div class="fw-sec"><div class="fw-sech"><span class="fw-sech-ttl">Restaurants</span></div><div class="fw-vrow">' +
            matchedVendors.map(vendorCardHTML).join('') + '</div></div>';
        }
        var items = (res.items || []).map(function (x) { return x.p; }).slice(0, 30);
        html += '<div class="fw-sec"><div class="fw-sech"><span class="fw-sech-ttl">' + items.length + ' result' + (items.length !== 1 ? 's' : '') + '</span></div>' +
          (items.length ? '<div class="fw-grid3">' + cardsHTML(items) + '</div>' : '<div class="fw-empty">No food or restaurants match &ldquo;' + esc(q) + '&rdquo;.</div>') +
          '</div>';
        resEl.innerHTML = html;
        resEl.style.display = '';
        wireVendorCards(resEl);
      }, 160);
    });
  }

  function renderVendorStrip(root, restaurants) {
    if (!restaurants.length) return;
    var row = h('div', 'fw-vrow', restaurants.map(function (r) { return vendorCardHTML(r.vendor); }).join(''));
    root.appendChild(row);
    wireVendorCards(row);
  }

  function renderCategories(root, foodProds) {
    var ct = global.catTree, rootCat = foodRoot();
    if (!ct || !rootCat) return;
    var kids = ct.visibleChildren(rootCat.id).filter(function (c) {
      return foodProds.some(ct.productMatcher(c.id));
    });
    if (!kids.length) return;
    var grid = h('div', 'fw-cats', kids.map(function (c) {
      var url = global.Pcx.Categories ? global.Pcx.Categories.imageUrl(c) : c.imageUrl;
      var letter = esc((c.name || '?')[0].toUpperCase());
      return '<div class="fw-cat" data-open-cat="' + esc(c.slug) + '">' +
        '<div class="fw-cat-thumb">' + (url ? '<img src="' + safeUrl(url) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + (!url ? letter : '') + '</div>' +
        '<div class="fw-cat-name">' + esc(c.name) + '</div></div>';
    }).join(''));
    root.appendChild(grid);
    grid.querySelectorAll('[data-open-cat]').forEach(function (el) {
      el.addEventListener('click', function () {
        var slug = el.dataset.openCat;
        if (typeof global.openCategory === 'function') global.openCategory(slug);
      });
    });
  }

  function recommendedFor(foodProds) {
    var recent = [];
    try { recent = (JSON.parse(localStorage.getItem('recent_viewed_v1')) || []).map(Number); } catch (e) {}
    var byId = {}; foodProds.forEach(function (p) { byId[p.id] = p; });
    var out = [], seen = {};
    recent.forEach(function (id) { if (byId[id] && !seen[id]) { seen[id] = 1; out.push(byId[id]); } });

    /* fill the rest by rotating across restaurants so no single restaurant dominates,
       using recency (created_at) / featured as the only honest "what's fresh" signals we actually have */
    var byVendor = {};
    foodProds.slice().sort(function (a, b) { return (b.featured === true) - (a.featured === true) || new Date(b.created_at) - new Date(a.created_at); })
      .forEach(function (p) { var k = p.vendor_id || 'house'; (byVendor[k] = byVendor[k] || []).push(p); });
    var vendorKeys = Object.keys(byVendor), i = 0, guard = 0;
    while (out.length < 12 && vendorKeys.some(function (k) { return byVendor[k].length; }) && guard++ < 500) {
      var k = vendorKeys[i % vendorKeys.length];
      var list = byVendor[k];
      if (list && list.length) { var p = list.shift(); if (!seen[p.id]) { seen[p.id] = 1; out.push(p); } }
      i++;
    }
    return out.slice(0, 12);
  }

  function renderRecommended(root, foodProds) {
    var items = recommendedFor(foodProds);
    if (!items.length) return;
    var sec = h('div', 'fw-sec',
      '<div class="fw-sech"><span class="fw-sech-ttl">Recommended For You</span></div>' +
      '<div class="fw-grid3">' + cardsHTML(items) + '</div>');
    root.appendChild(sec);
  }

  function renderRestaurantSection(root, r, headingWord) {
    var products = r.products.slice()
      .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
      .slice(0, 12);
    if (!products.length) return;
    var v = r.vendor, letter = esc((v.business_name || '?')[0].toUpperCase());
    var sec = h('div', 'fw-sec');
    var hdr = h('div', 'fw-sech',
      '<div class="fw-sech-logo" style="background:var(--red)">' + (v.logo_url ? '<img src="' + safeUrl(v.logo_url) + '" alt="" loading="lazy" onerror="this.parentNode.textContent=\'' + letter + '\'">' : letter) + '</div>' +
      '<span class="fw-sech-ttl">' + esc(headingWord) + ' from ' + esc(v.business_name) + '</span>' +
      '<button type="button" class="fw-sech-more" data-open-store="' + esc(v.store_slug || v.id) + '">See more</button>');
    var row = h('div', 'fw-hrow', products.map(function (p) { return '<div class="fcard-wrap">' + global.cardHTML(p) + '</div>'; }).join(''));
    sec.appendChild(hdr); sec.appendChild(row);
    root.appendChild(sec);

    hdr.querySelectorAll('[data-open-store]').forEach(function (el) { el.addEventListener('click', function () { global.openStore(el.dataset.openStore); }); });
    var logoEl = hdr.querySelector('.fw-sech-logo');
    logoEl.style.cursor = 'pointer';
    logoEl.addEventListener('click', function () { global.openStore(v.store_slug || v.id); });

    accentFor(v.logo_url, function (color) { if (color) logoEl.style.background = color; });
  }

  function renderQuickSnacks(root, foodProds) {
    var ct = global.catTree, rc = foodRoot();
    var snackCat = ct && rc ? ct.descendantIds(rc.id).map(function (id) { return ct.byId[id]; }).find(function (c) { return c && /snack/i.test(c.name); }) : null;
    var pool = snackCat ? foodProds.filter(ct.productMatcher(snackCat.id)) : foodProds.filter(function (p) { return /snack/i.test(productHay(p)); });
    if (pool.length < 3) return;
    var items = shuffle(pool).slice(0, 5);
    var sec = h('div', 'fw-sec',
      '<div class="fw-sech"><span class="fw-sech-ttl">Quick Snacks</span></div>' +
      '<div class="fw-hrow">' + items.map(function (p) { return '<div class="fcard-wrap">' + global.cardHTML(p) + '</div>'; }).join('') + '</div>');
    root.appendChild(sec);
  }

  var THEMES = [
    { title: 'Chilled Drinks for Hot Weather', words: ['chilled', 'cold drink', 'juice', 'smoothie', 'soft drink', 'malt', 'soda', 'drink'] },
    { title: 'Sweet Treats', words: ['dessert', 'sweet', 'cake', 'chin chin', 'puff puff', 'doughnut', 'donut', 'pastry'] },
    { title: 'Cold & Creamy', words: ['ice cream', 'icecream', 'parfait', 'milkshake', 'yoghurt', 'yogurt'] },
    { title: 'Zobo & Local Drinks', words: ['zobo', 'kunu', 'chapman', 'palm wine', 'local drink'] },
    { title: 'Tiger Nuts', words: ['tiger nut', 'tigernut', 'aya'] },
    { title: 'Hot Food of the Day', words: ['jollof', 'soup', 'swallow', 'grilled', 'fried rice', 'pepper soup', 'stew'] },
    { title: 'Light Food to Lift Your Mood', words: ['salad', 'snack', 'wrap', 'sandwich', 'spring roll', 'shawarma', 'light'] }
  ];

  function themeMatches(foodProds, words) {
    return foodProds.filter(function (p) { var hay = productHay(p); return words.some(function (w) { return hay.indexOf(w) >= 0; }); });
  }

  function renderTheme(root, theme, foodProds) {
    var items = themeMatches(foodProds, theme.words);
    if (items.length < 3) return false;
    items = shuffle(items).slice(0, 10);
    var sec = h('div', 'fw-sec',
      '<div class="fw-sech"><span class="fw-sech-ttl">' + esc(theme.title) + '</span></div>' +
      '<div class="fw-hrow">' + items.map(function (p) { return '<div class="fcard-wrap">' + global.cardHTML(p) + '</div>'; }).join('') + '</div>');
    root.appendChild(sec);
    return true;
  }

  /* ---------------------------------------------------------------- mount */

  function mount(root, world, deps) {
    root.textContent = '';
    root.style.removeProperty('--wp-grad');
    var wrap = h('div', 'fw-root');

    var hdr = h('header', 'wp-hdr');
    var backBtn = document.createElement('button');
    backBtn.type = 'button'; backBtn.className = 'wp-back'; backBtn.setAttribute('aria-label', 'Back');
    backBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    backBtn.addEventListener('click', function () { deps.onBack(); });
    var ttl = document.createElement('span'); ttl.className = 'wp-hdr-ttl'; ttl.textContent = world.name || 'Food';
    hdr.appendChild(backBtn); hdr.appendChild(ttl);
    wrap.appendChild(hdr);

    var foodProds = foodProductsList();

    if (!foodRoot()) {
      wrap.appendChild(h('div', 'fw-empty', 'Food categories haven\u2019t been set up yet. Create a category with the slug &ldquo;food&rdquo; in Admin &rsaquo; Categories to switch this on.'));
      root.appendChild(wrap);
      return;
    }
    if (!foodProds.length) {
      wrap.appendChild(h('div', 'fw-empty', 'No food products yet. Once a restaurant lists something under Food, it\u2019ll show up here.'));
      root.appendChild(wrap);
      return;
    }

    var restaurants = shuffle(eligibleRestaurants(foodProds));

    renderSearch(wrap, foodProds, restaurants);
    renderVendorStrip(wrap, restaurants);
    renderCategories(wrap, foodProds);
    renderRecommended(wrap, foodProds);

    /* interleave: restaurant, quick snacks, then themed/restaurant alternating (spec section 9) */
    var headings = ['Delicious meals', 'Popular meals', 'Fresh meals', 'Tasty meals', 'More to try'];
    var ri = 0;
    var themeQueue = THEMES.slice();
    var usedRestaurants = restaurants.slice();

    function nextRestaurant() { return usedRestaurants.length ? usedRestaurants.shift() : null; }

    var r = nextRestaurant();
    if (r) renderRestaurantSection(wrap, r, headings[ri++ % headings.length]);
    renderQuickSnacks(wrap, foodProds);

    while (usedRestaurants.length || themeQueue.length) {
      var theme = themeQueue.shift();
      if (theme) renderTheme(wrap, theme, foodProds);
      var next = nextRestaurant();
      if (next) renderRestaurantSection(wrap, next, headings[ri++ % headings.length]);
      if (!theme && !next) break;
    }

    root.appendChild(wrap);
  }

  Pcx.FoodWorld = { mount: mount };
})(window);
