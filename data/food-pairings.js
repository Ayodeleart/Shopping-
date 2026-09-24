/* Pcx.FoodPairings
 * Decides what to suggest under "Complete your meal" on a food product's page.
 *
 * Two layers, in priority order:
 *  1. EXPLICIT — rows in `product_pairings` (see migration_food_pairings.sql), curated by the
 *     vendor for their own products (RLS enforces same-vendor-only writes). Always shown first.
 *  2. FALLBACK — a static "this kind of food usually goes with that kind of food" keyword map
 *     (e.g. Swallow -> Soup, Protein), used only to find REAL same-vendor products that already
 *     exist in whatever category names this store happens to use. If nothing matches, nothing is
 *     shown — this never invents a product or a category that doesn't exist.
 *
 * Nothing here talks to Supabase or the DOM: it works on data already loaded by index.html
 * (allProds, catTree, vendorsMap) plus whatever explicit rows the caller fetched.
 *
 *   Pcx.FoodPairings.isFoodProduct(p, catTree)
 *   Pcx.FoodPairings.suggestionsFor(product, { catTree, allProds, explicitRows, limit })
 *     -> [{ product, reason: 'explicit'|'suggested' }, ...]   (already deduped, already capped)
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  /* keyword -> array of keywords for products that typically accompany it.
     Matched against a product's own name + full category path (all lowercased),
     so it works whatever the admin/vendor happened to name their categories. */
  var PAIR_MAP = [
    { when: ['eba', 'swallow', 'fufu', 'amala', 'semo', 'pounded yam', 'garri'],
      with: ['soup', 'egusi', 'ogbono', 'okro', 'okra', 'efo', 'protein', 'meat', 'beef', 'goat', 'fish', 'chicken'] },
    { when: ['bread'],
      with: ['beans', 'akara', 'plantain', 'egg', 'sausage'] },
    { when: ['rice', 'jollof', 'fried rice'],
      with: ['chicken', 'beef', 'plantain', 'salad', 'fish', 'turkey', 'coleslaw'] },
    { when: ['yam', 'boiled yam', 'fried yam'],
      with: ['egg sauce', 'stew', 'fish', 'meat', 'sauce'] },
    { when: ['noodles', 'spaghetti', 'pasta'],
      with: ['egg', 'chicken', 'sausage', 'fish'] },
    { when: ['beans', 'ewa agoyin'],
      with: ['plantain', 'bread', 'egg', 'garri', 'sauce'] },
    { when: ['shawarma', 'burger', 'sandwich'],
      with: ['fries', 'chips', 'drink', 'soft drink', 'coleslaw'] },
    { when: ['pizza'],
      with: ['drink', 'soft drink', 'wing', 'sauce'] },
  ];

  function norm(s) { return String(s || '').toLowerCase(); }
  function hasAny(hay, words) { return words.some(function (w) { return hay.indexOf(w) >= 0; }); }

  function catText(p, catTree) {
    if (!catTree) return norm(p.category);
    var id = p.category_id;
    if (id == null || !catTree.byId[id]) return norm(p.category);
    return norm(catTree.label(id, ' '));
  }

  function productHay(p, catTree) { return norm(p.name) + ' ' + catText(p, catTree); }

  /* A product counts as "food" if it (or any ancestor category) is the Food world root,
     with the same category_id/text fallback the rest of the category system already uses. */
  function isFoodProduct(p, catTree) {
    if (!p) return false;
    if (!catTree) return false;
    var root = catTree.bySlug && catTree.bySlug.food;
    if (!root) return false;
    return catTree.productMatcher(root.id)(p);
  }

  function pairKeywordsFor(p, catTree) {
    var hay = productHay(p, catTree), out = [];
    PAIR_MAP.forEach(function (rule) {
      if (hasAny(hay, rule.when)) out = out.concat(rule.with);
    });
    return out;
  }

  function suggestionsFor(product, opts) {
    opts = opts || {};
    var catTree = opts.catTree, allProds = opts.allProds || [], explicitRows = opts.explicitRows || [];
    var limit = opts.limit || 6;
    var out = [], seen = {};
    seen[product.id] = 1;

    var byId = {};
    allProds.forEach(function (p) { byId[p.id] = p; });

    /* 1) explicit, vendor-curated */
    explicitRows
      .filter(function (r) { return r.product_id === product.id; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
      .forEach(function (r) {
        var p = byId[r.pair_product_id];
        if (p && !seen[p.id]) { seen[p.id] = 1; out.push({ product: p, reason: 'explicit' }); }
      });

    if (out.length >= limit) return out.slice(0, limit);

    /* 2) fallback: same-vendor products matching the keyword map */
    var keywords = pairKeywordsFor(product, catTree);
    if (keywords.length) {
      var candidates = allProds.filter(function (p) {
        if (seen[p.id]) return false;
        if ((product.vendor_id || null) !== (p.vendor_id || null)) return false;   // same restaurant only
        return hasAny(productHay(p, catTree), keywords);
      });
      candidates.forEach(function (p) {
        if (out.length >= limit) return;
        seen[p.id] = 1;
        out.push({ product: p, reason: 'suggested' });
      });
    }

    return out.slice(0, limit);
  }

  Pcx.FoodPairings = { isFoodProduct: isFoodProduct, suggestionsFor: suggestionsFor, PAIR_MAP: PAIR_MAP };
})(window);
