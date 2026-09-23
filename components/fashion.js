/* Pcx.Fashion — data helpers for the Fashion world (#world=fashion).
 *
 * Everything here reads EXISTING structures; nothing is invented:
 *   • Gender cards / hero ads / discovery sections  → `fashion_genders`, `fashion_ads`,
 *     `fashion_sections` (see migration_fashion.sql). Every fetch degrades gracefully
 *     (missing:false) when the SQL has not been run yet, so the page still works.
 *   • Fashion categories → rows of the EXISTING `categories` table tagged
 *     `world = 'fashion' | 'both'` (Pcx.Categories.Tree carries `world` on each row).
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
  /* Fashion categories = active tree roots (any depth) tagged world 'fashion' | 'both'. */
  function fashionRoots(tree) {
    if (!tree) return [];
    return tree.list.filter(function (c) {
      return c.active && (c.world === 'fashion' || c.world === 'both') && c.parentId == null;
    });
  }

  /* One matcher covering every fashion category (and its subcategories, via the
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
    productMatcher: productMatcher
  };
})(window);
