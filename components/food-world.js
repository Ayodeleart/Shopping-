/* Pcx.FoodWorld
 * The Food-only extras of the Explore Marcato Food world (#world=food): restaurant strip, Recommended For You, Quick
 * Snacks, themed discovery rows and one section per restaurant. It is registered as Pcx.WorldExtensions.food, and
 * components/world-page.js calls it for the food slug instead of the generic layout.
 *
 * The screen is:  search -> hero -> display categories (5 per row) -> food content.
 * The hero and the display categories are NOT built here: they come from the same generic code every world uses
 * (components/world-sections.js) and from the world's own configuration (Admin > Banners > Explore Marcato > Food).
 * "Food" is decided by that configuration: a product is food when it sits in a normal category that one of the
 * Food display categories links to (plus everything under the normal category slugged "food", if the store has one).
 *
 * Deliberately reuses rather than re-implements:
 *   - the storefront's already-loaded products / vendors / category tree, handed in through `ctx` (getters, no globals:
 *     `let` variables in the page script are not properties of `window`, which is why the old version never saw them)
 *   - cardHTML() from components/product-card.js for every product card
 *   - openStore() for restaurant profiles and Pcx.Search (data/search.js) for the search bar
 *
 *   Pcx.FoodWorld.render(bodyEl, world, config, ctx);
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

  var C = null;       // the ctx of the world page being drawn (a bag of getters)
  function tree() { return C && C.tree ? C.tree() : null; }
  function vendors() { return (C && C.vendors && C.vendors()) || {}; }
  /* the normal marketplace category with the same slug as the world, when the store has one */
  function legacyRoot() { var t = tree(); return t && t.bySlug ? t.bySlug.food || null : null; }

  function catText(p) {
    var ct = tree();
    if (ct && p.category_id != null && ct.byId[p.category_id]) return ct.label(p.category_id, ' ').toLowerCase();
    return String(p.category || '').toLowerCase();
  }
  function productHay(p) { return (String(p.name || '') + ' ' + catText(p) + ' ' + String(p.description || '')).toLowerCase(); }

  function vendorOf(p) { return p.vendor_id ? vendors()[p.vendor_id] : null; }

  /* eligible restaurants: approved vendors (vendorsMap is already approved-only) with >=1 real food product */
  function eligibleRestaurants(foodProds) {
    var byVendor = {};
    foodProds.forEach(function (p) {
      if (!p.vendor_id || !vendors()[p.vendor_id]) return;
      (byVendor[p.vendor_id] = byVendor[p.vendor_id] || []).push(p);
    });
    return Object.keys(byVendor).map(function (id) {
      return { vendor: vendors()[id], products: byVendor[id] };
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

  function cardsHTML(list) { return list.map(function (p) { return '<div>' + C.cardHTML(p) + '</div>'; }).join(''); }

  function vendorCardHTML(v) {
    var letter = esc((v.business_name || '?')[0].toUpperCase());
    return '<div class="fw-vcard" data-open-store="' + esc(v.store_slug || v.id) + '">' +
      '<div class="fw-vlogo">' + (v.logo_url ? '<img src="' + safeUrl(v.logo_url) + '" alt="" loading="lazy" onerror="this.parentNode.textContent=\'' + letter + '\'">' : letter) + '</div>' +
      '<div class="fw-vname">' + esc(v.business_name || '') + '</div>' +
      '</div>';
  }

  function wireVendorCards(scope) {
    scope.querySelectorAll('[data-open-store]').forEach(function (el) {
      el.addEventListener('click', function () { C.openStore(el.dataset.openStore); });
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
    var row = h('div', 'fw-hrow', products.map(function (p) { return '<div class="fcard-wrap">' + C.cardHTML(p) + '</div>'; }).join(''));
    sec.appendChild(hdr); sec.appendChild(row);
    root.appendChild(sec);

    hdr.querySelectorAll('[data-open-store]').forEach(function (el) { el.addEventListener('click', function () { C.openStore(el.dataset.openStore); }); });
    var logoEl = hdr.querySelector('.fw-sech-logo');
    logoEl.style.cursor = 'pointer';
    logoEl.addEventListener('click', function () { C.openStore(v.store_slug || v.id); });

    accentFor(v.logo_url, function (color) { if (color) logoEl.style.background = color; });
  }

  function renderQuickSnacks(root, foodProds) {
    var ct = tree(), rc = legacyRoot();
    var snackCat = ct && rc ? ct.descendantIds(rc.id).map(function (id) { return ct.byId[id]; }).find(function (c) { return c && /snack/i.test(c.name); }) : null;
    var pool = snackCat ? foodProds.filter(ct.productMatcher(snackCat.id)) : foodProds.filter(function (p) { return /snack/i.test(productHay(p)); });
    if (pool.length < 3) return;
    var items = shuffle(pool).slice(0, 5);
    var sec = h('div', 'fw-sec',
      '<div class="fw-sech"><span class="fw-sech-ttl">Quick Snacks</span></div>' +
      '<div class="fw-hrow">' + items.map(function (p) { return '<div class="fcard-wrap">' + C.cardHTML(p) + '</div>'; }).join('') + '</div>');
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
      '<div class="fw-hrow">' + items.map(function (p) { return '<div class="fcard-wrap">' + C.cardHTML(p) + '</div>'; }).join('') + '</div>');
    root.appendChild(sec);
    return true;
  }

  /* ---------------------------------------------------------------- mount */

  function render(wrap, world, config, ctx) {
    C = ctx;
    var WS = Pcx.WorldSections;
    var foodProds = WS.worldProducts(ctx, world, config);

    /* the hero and the display categories are the world's own content: shown whether or not any food is listed yet */
    var restaurants = shuffle(eligibleRestaurants(foodProds));
    if (foodProds.length) renderSearch(wrap, foodProds, restaurants);
    WS.renderHero(wrap, config.heroes, ctx);
    WS.renderDisplayCategories(wrap, config.cats, ctx);

    if (!foodProds.length) {
      var noCats = !(config.cats && config.cats.length);
      wrap.appendChild(h('div', 'fw-empty', noCats && !(config.heroes && config.heroes.length)
        ? 'The Food world is being set up. Check back soon.'
        : 'No food products yet. Once a restaurant lists something under Food, it\u2019ll show up here.'));
      return;
    }

    renderVendorStrip(wrap, restaurants);
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
  }

  Pcx.FoodWorld = { render: render };
  (Pcx.WorldExtensions = Pcx.WorldExtensions || {}).food = render;

})(window);
