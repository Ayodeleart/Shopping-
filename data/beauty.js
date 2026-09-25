/* data/beauty.js
 * Pcx.BeautyData — pure logic behind the Beauty world (Explore Marcato > Beauty).
 *
 * The Beauty world is NOT a separate system: it is a view over the existing
 * products + categories tables. A product belongs to Beauty when its category
 * sits under the "Beauty" main category (slug `beauty`) in the existing
 * category tree — exactly the way the Food world works. Beauty categories
 * (the round tiles) are rows in the `beauty_categories` table; each one either
 * points at a real existing category (category_id, using the same
 * product/category relationship) or falls back to honest keyword matching
 * against the product's category labels, so a tile shows products only when
 * real products are actually filed there. Nothing is faked: empty pools are
 * reported as empty, popularity is computed from real order/review data, and
 * the Man/Woman/Kids filters only exist when a matching real category exists.
 *
 * Everything here is a pure function over plain data (no DOM, no network) so
 * it can be unit-tested with node --test.
 *
 * Needs data/categories.js (Pcx.Categories.Tree).
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  var ROOT_SLUG = 'beauty';

  /* ── category tree ─────────────────────────────────────────────── */

  /* The active main category that anchors the Beauty world, or null.
     (Tree rows are normalized: the flag is `active`, see data/categories.js.) */
  function root(catTree) {
    if (!catTree) return null;
    var r = catTree.bySlug[ROOT_SLUG];
    return r && r.active !== false ? r : null;
  }

  /* Category ids the Beauty tiles point at (beauty_categories.category_id). A store may file its beauty
     products under categories such as "Makeup" or "Skincare" without a main category slugged `beauty`;
     linking a tile to that category is what makes those real products part of the Beauty world. */
  function linkedIds(rows) {
    var seen = {}, out = [];
    (rows || []).forEach(function (c) {
      if (!c || c.active === false || c.category_id == null || c.category_id === '') return;
      var id = Number(c.category_id);
      if (!isNaN(id) && !seen[id]) { seen[id] = 1; out.push(id); }
    });
    return out;
  }

  /* The category roots that make up the Beauty world: the `beauty` main category (when it exists)
     plus every category a Beauty tile is linked to. */
  function scopeRoots(catTree, extraIds) {
    if (!catTree) return [];
    var roots = [], r = root(catTree);
    if (r) roots.push(r);
    (extraIds || []).forEach(function (id) {
      var c = catTree.byId && catTree.byId[id];
      if (c && c.active !== false && !roots.some(function (x) { return x.id === c.id; })) roots.push(c);
    });
    return roots;
  }

  function scopeMatcher(catTree, extraIds) {
    var roots = scopeRoots(catTree, extraIds);
    if (!roots.length) return null;
    var ms = roots.map(function (r) { return catTree.productMatcher(r.id); });
    return function (p) { return ms.some(function (m) { return m(p); }); };
  }

  /* Every product in the Beauty world, in the given order.
     Returns [] (never null) when the world has no anchor yet. */
  function pool(catTree, products, extraIds) {
    var m = scopeMatcher(catTree, extraIds);
    if (!m || !products) return [];
    return products.filter(function (p) { return m(p); });
  }

  /* Is this one product a Beauty product? (Used to theme the shared product page.) */
  function isBeautyProduct(p, catTree, extraIds) {
    var m = scopeMatcher(catTree, extraIds);
    return !!(m && p && m(p));
  }

  function descendantCats(catTree, rootId) {
    if (!catTree) return [];
    var ids = catTree.descendantIds(rootId) || [];
    return ids.map(function (id) { return catTree.byId[id]; }).filter(Boolean);
  }

  /* ── beauty_categories rows ────────────────────────────────────── */

  var KIND_ALL = 'all', KIND_NEW = 'new', KIND_BEST = 'best', KIND_CAT = 'category';

  /* Normalize raw `beauty_categories` rows: keep active ones, sorted by sort_order then name. */
  function activeCats(rows) {
    return (rows || []).filter(function (c) { return c && c.active !== false && c.name; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name)); });
  }

  /* same rule as data/categories.js slugify, so "Men's Grooming" -> "mens-grooming" */
  function slugify(s) {
    return String(s || '').trim().toLowerCase().replace(/['\u2019]/g, '').replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* stem a word just enough for "lips" ~ "lipstick" style matches: lowercase, alphanumerics only, drop one trailing s */
  function stem(w) {
    w = String(w || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (w.length > 3 && w.slice(-1) === 's') w = w.slice(0, -1);
    return w;
  }
  function words(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem);
  }

  /* A beauty category tile matches a product when:
     - kind 'all'      -> product is in the Beauty pool
     - kind 'new'/'best' -> product is in the Beauty pool (ordering is applied by the caller)
     - kind 'category' -> category_id set: the product's category is that category or a descendant
                          (the existing product/category relationship), otherwise any of the
                          tile's keywords appears in the product's category labels. */
  function matchRow(row, ctx) {
    ctx = ctx || {};
    var catTree = ctx.catTree, poolSet = ctx.poolSet;
    var inPool = function (p) { return poolSet ? poolSet.has(p.id) : true; };
    if (!row || !row.kind || row.kind === KIND_ALL) return inPool;
    if (row.kind === KIND_NEW || row.kind === KIND_BEST) return inPool;

    var cacheKey = 'cat:' + row.category_id;
    if (row.category_id != null && catTree) {
      if (!ctx.matchers) ctx.matchers = {};
      var m = ctx.matchers[cacheKey];
      if (!m) { m = ctx.matchers[cacheKey] = catTree.productMatcher(Number(row.category_id)); }
      return function (p) { return inPool(p) && m(p); };
    }
    var kws = (row.keywords || row.name || '').split(/[,\n]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var kwWords = kws.map(words).filter(function (w) { return w.length; });
    if (!kwWords.length) return function () { return false; };
    /* a keyword word matches a category word when they are equal or one is a real
       (3+ letter) prefix of the other — "lips" matches "lipstick", "hair" matches
       "haircare" — so the tile only ever matches what the category says. */
    function hit(a, b) {
      if (!a || !b) return false;
      if (a === b) return true;
      if (a.length >= 3 && b.indexOf(a) === 0) return true;
      if (b.length >= 3 && a.indexOf(b) === 0) return true;
      return false;
    }
    return function (p) {
      if (!inPool(p)) return false;
      var labels = (ctx.catNames && ctx.catNames(p)) || (p.category ? [p.category] : []);
      var hayWords = words(labels.join(' '));
      for (var i = 0; i < kwWords.length; i++) {
        for (var j = 0; j < kwWords[i].length; j++) {
          for (var k = 0; k < hayWords.length; k++) {
            if (hit(kwWords[i][j], hayWords[k])) return true;
          }
        }
      }
      return false;
    };
  }

  /* ── filters ───────────────────────────────────────────────────── */

  /* Newest first (real created_at). */
  function sortNewest(list) {
    return list.slice().sort(function (a, b) { return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0); });
  }

  /* Most popular first. scoreOf(p) must come from REAL signals only
     (order_items sold qty, review counts) — never invented. */
  function sortPopular(list, scoreOf) {
    return list.slice().sort(function (a, b) {
      var s = (scoreOf(b) || 0) - (scoreOf(a) || 0);
      if (s) return s;
      return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
    });
  }

  /* The Man / Woman / Kids filters map onto real Beauty subcategories
     (Men's Beauty, Women's Beauty, Kids Beauty). A filter is null when no
     such category exists, so the UI can hide it instead of faking a result. */
  var PERSON_PATTERNS = {
    man: { slugs: ['men', 'mens', 'man', 'mens-beauty', 'mens-grooming'], re: /(^|[-_\s])(men|men's|man)([-_\s]|$)/i },
    woman: { slugs: ['women', 'woman', 'womens', 'womens-beauty'], re: /(^|[-_\s])(women|woman|women's)([-_\s]|$)/i },
    kids: { slugs: ['kids', 'children', 'kid', 'kids-beauty'], re: /(^|[-_\s])(kids?|children|child)([-_\s]|$)/i }
  };

  function personFilters(catTree, extraIds) {
    var roots = scopeRoots(catTree, extraIds);
    var out = { man: null, woman: null, kids: null };
    if (!roots.length) return out;
    var subs = [];
    roots.forEach(function (r) { subs = subs.concat(descendantCats(catTree, r.id), [r]); });
    Object.keys(PERSON_PATTERNS).forEach(function (key) {
      var pat = PERSON_PATTERNS[key];
      var hit = subs.find(function (c) {
        var slug = String(c.slug || '').toLowerCase();
        var name = String(c.name || '');
        return pat.slugs.indexOf(slug) !== -1 || pat.re.test(slug) || pat.re.test(name);
      });
      if (hit) out[key] = catTree.productMatcher(hit.id);
    });
    return out;
  }

  /* Popularity from real data only:
     stats: { [productId]: { sold: n, reviews: n } } — sold = completed order item qty, reviews = real review count. */
  function score(p, stats) {
    var s = stats && stats[p.id];
    if (!s) return 0;
    return (s.sold || 0) * 3 + (s.reviews || 0);
  }

  /* ── settings + hero ───────────────────────────────────────────── */

  /* beauty_settings key/value rows -> object (an already-mapped object is passed through). */
  function settingsMap(rows) {
    var out = {};
    if (!rows) return out;
    if (!Array.isArray(rows)) {
      Object.keys(rows).forEach(function (k) { out[k] = rows[k] == null ? '' : String(rows[k]); });
      return out;
    }
    rows.forEach(function (r) { if (r && r.key != null) out[r.key] = r.value == null ? '' : String(r.value); });
    return out;
  }

  /* The Beauty background URL, or '' when not set / disabled. */
  function backgroundUrl(settings) {
    settings = settings || {};
    if (settings.background_enabled === '0' || settings.background_enabled === 'false') return '';
    return settings.background_url || '';
  }

  /* The built-in Beauty background (used until the admin uploads their own, or when theirs is switched off). */
  var DEFAULT_BG = '/components/beauty-bg.jpg';
  function backgroundOrDefault(settings) { return backgroundUrl(settings) || DEFAULT_BG; }

  /* beauty_heroes rows -> promo objects for the shared promotional carousel. */
  function heroPromos(rows) {
    return (rows || []).filter(function (h) { return h && h.active !== false && (h.image_url || h.title); })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0); })
      .map(function (h) {
        var promo = { id: 'beauty-hero-' + h.id, image: h.image_url || '', label: '' };
        if (h.title) promo.title = h.title;
        if (h.subtitle) promo.meta = h.subtitle;
        if (h.cta_text) promo.cta = h.cta_text;
        if (h.link_url) promo.href = h.link_url;
        return promo;
      });
  }

  Pcx.BeautyData = {
    ROOT_SLUG: ROOT_SLUG,
    KIND_ALL: KIND_ALL, KIND_NEW: KIND_NEW, KIND_BEST: KIND_BEST, KIND_CAT: KIND_CAT,
    root: root,
    linkedIds: linkedIds,
    scopeMatcher: scopeMatcher,
    pool: pool,
    isBeautyProduct: isBeautyProduct,
    activeCats: activeCats,
    slugify: slugify,
    matchRow: matchRow,
    sortNewest: sortNewest,
    sortPopular: sortPopular,
    personFilters: personFilters,
    score: score,
    settingsMap: settingsMap,
    backgroundUrl: backgroundUrl,
    DEFAULT_BG: DEFAULT_BG,
    backgroundOrDefault: backgroundOrDefault,
    heroPromos: heroPromos
  };
})(window);
