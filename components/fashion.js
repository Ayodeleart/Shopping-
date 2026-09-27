/* Pcx.Fashion — data helpers for the Fashion world (#world=fashion).
 *
 * Everything here reads EXISTING structures; nothing is invented:
 *   • Gender cards / hero ads / discovery sections  → `fashion_genders`, `fashion_ads`,
 *     `fashion_sections` (see migration_fashion.sql). Every fetch degrades gracefully
 *     (missing:false) when the SQL has not been run yet, so the page still works.
 *   • Fashion categories → the world is anchored on the REAL main categories
 *     "Fashion & Clothing" (slug `fashion-clothing`) and "Kids Fashion" (slug
 *     `kids-fashion`) — see ROOT_SLUGS below. Every existing subcategory under either
 *     one (any depth) is a Fashion category automatically; nothing needs to be tagged,
 *     retyped or duplicated. Images, GIFs, names, order and visibility for those
 *     subcategories are the SAME fields the main Categories admin screen already
 *     manages — the Fashion admin only reorders/hides, it never forks the data.
 *   • A product's gender → `products.attributes.gender` ('Men' | 'Women' | 'Unisex' |
 *     'Boys' | 'Girls') exactly as the existing product forms (vendor + admin)
 *     already save it via components/product-attributes.js.
 *   • A product's sizes → `products.attributes` again: `sizes` ({system, values}),
 *     `waist`, or `band` (+ `cups`) depending on the product type. No sizes → no
 *     size selector, so non-clothing products are never forced into letter sizes.
 */
(function (global) {
  'use strict';

  var Pcx = global.Pcx = global.Pcx || {};

  var WORLD = 'fashion';

  function asList(r) {
    if (r && !r.error && Array.isArray(r.data)) return { rows: r.data, missing: false };
    /* 42P01 = undefined_table / PGRST205 = relation not in schema cache: the SQL is not run yet */
    var missing = !!(r && r.error && /42P01|PGRST205|does not exist|Could not find the table|schema cache/i.test((r.error.message || '') + ' ' + (r.error.code || '')));
    return { rows: [], missing: missing, error: r && r.error };
  }

  /* ---------------------------------------------------------------- fetch */
  async function fetchGenders(sb) {
    var r = await sb.from('fashion_genders').select('*').order('sort_order', { ascending: true });
    var out = asList(r);
    out.rows = out.rows.filter(function (g) { return g.active !== false; });
    return out;
  }

  async function fetchAds(sb) {
    var r = await sb.from('fashion_ads').select('*').eq('active', true).order('sort_order', { ascending: true });
    return asList(r);
  }

  async function fetchSections(sb) {
    var r = await sb.from('fashion_sections').select('*').eq('active', true).order('sort_order', { ascending: true });
    return asList(r);
  }

  /* ---------------------------------------------------------------- gender */
  var GENDER_SLUG = { men: 'men', woman: 'women', women: 'women', boy: 'boys', boys: 'boys', girl: 'girls', girls: 'girls', unisex: 'unisex' };

  function attr(a) { return (a && typeof a === 'object' && !Array.isArray(a)) ? a : {}; }

  /* 'Men' | 'Women' | 'Unisex' | 'Boys' | 'Girls' -> 'men' | 'women' | 'boys' | 'girls' | 'unisex' | null */
  function genderOf(p) {
    var g = attr(p && p.attributes).gender;
    if (!g) return null;
    return GENDER_SLUG[String(g).trim().toLowerCase()] || null;
  }

  /* Does this product belong in a `men` / `women` / `boys` / `girls` filter?
     Unisex matches every filter; products without a gender never match one. */
  function matchesGender(p, slug) {
    if (!slug) return true;
    var g = genderOf(p);
    if (!g) return false;
    return g === 'unisex' || g === slug;
  }

  /* ---------------------------------------------------------------- sizes */
  function values(v) {
    return Array.isArray(v) ? v.map(function (x) { return String(x); }).filter(Boolean) : [];
  }

  /* Size groups for the product page, oldest data shapes included.
     Returns [] for products that need no size (bags, watches, accessories ...).
     Each group: { key, label, values } — key ∈ size | waist | band | cups. */
  function sizeGroups(p) {
    var a = attr(p && p.attributes), out = [];
    var sizes = a.sizes;
    if (sizes && Array.isArray(sizes.values) && sizes.values.length) {
      out.push({ key: 'size', label: (sizes.system ? 'Size (' + sizes.system + ')' : 'Size'), values: values(sizes.values) });
    }
    var waist = values(a.waist);
    if (waist.length) out.push({ key: 'waist', label: 'Waist (inches)', values: waist });
    var band = values(a.band);
    if (band.length) out.push({ key: 'band', label: 'Band size', values: band });
    var cups = values(a.cups);
    if (cups.length && band.length) out.push({ key: 'cups', label: 'Cup size', values: cups });
    return out;
  }

  /* Join the picked values the way it is written on a label ("M", "30 / B"). */
  function sizeLabel(picked) {
    return (picked || []).filter(Boolean).join(' / ');
  }

  /* ---------------------------------------------------------------- world products */
  /* The real, existing main categories that anchor the Fashion World. Anything filed
     under either one (at any depth) is a Fashion product — no `categories.world` tag,
     no second catalogue. Add a slug here if another main category should join the
     Fashion World later; nothing else needs to change. */
  var ROOT_SLUGS = ['fashion-clothing', 'kids-fashion'];

  function fashionRoots(tree) {
    if (!tree) return [];
    return ROOT_SLUGS.map(function (slug) { return tree.bySlug[slug]; })
      .filter(function (c) { return c && c.active; });
  }

  /* The real subcategories shoppers browse inside the Fashion world (circular tiles,
     category chips, per-category rails): the direct children of every Fashion root,
     in their existing sort order. Each is an ordinary `categories` row — its image,
     GIF, name and visibility are edited on the main Categories admin screen exactly
     like any other category; hiding it there hides it here too. */
  function fashionCategories(tree) {
    if (!tree) return [];
    var out = [], seen = {};
    fashionRoots(tree).forEach(function (root) {
      tree.visibleChildren(root.id).forEach(function (c) {
        if (!seen[c.id]) { seen[c.id] = 1; out.push(c); }
      });
    });
    return out.sort(function (a, b) { return (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name)); });
  }

  /* One matcher covering every fashion root (and everything under them, via the
     existing tree machinery — legacy text categories keep matching too). */
  function productMatcher(tree) {
    var roots = fashionRoots(tree);
    if (!roots.length) return function () { return false; };
    var matchers = roots.map(function (c) { return tree.productMatcher(c.id); });
    return function (p) {
      for (var i = 0; i < matchers.length; i++) if (matchers[i](p)) return true;
      return false;
    };
  }

  Pcx.Fashion = {
    WORLD: WORLD,
    fetchGenders: fetchGenders,
    fetchAds: fetchAds,
    fetchSections: fetchSections,
    genderOf: genderOf,
    matchesGender: matchesGender,
    sizeGroups: sizeGroups,
    sizeLabel: sizeLabel,
    fashionRoots: fashionRoots,
    fashionCategories: fashionCategories,
    productMatcher: productMatcher
  };
})(window);
