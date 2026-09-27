/* Home & Decor data helpers.
 *
 * This module does not own a catalogue. It connects the dedicated Home & Decor
 * presentation to Marcato's existing category tree, world_category_links and
 * products. The same helpers are used by the storefront and by the existing
 * admin/vendor product forms so a category linked to the Home world becomes
 * furniture-eligible without a code change.
 */
(function (global) {
  'use strict';

  var Pcx = global.Pcx = global.Pcx || {};
  var ATTR = '_home_image_url';
  var ROOT_SLUGS = { home: 1, 'home-decor': 1, furniture: 1, 'home-furniture': 1 };

  function uniq(values) {
    var seen = {};
    return (values || []).filter(function (v) {
      var k = String(v);
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  /* The generic world admin owns these relationships. Missing Explore tables
     are intentionally treated as an empty list so older deployments still boot. */
  async function linkedCategoryIds(sb) {
    try {
      var cr = await sb.from('world_display_categories').select('id')
        .eq('world_slug', 'home').eq('is_active', true);
      if (cr.error || !cr.data || !cr.data.length) return [];
      var lr = await sb.from('world_category_links').select('category_id')
        .in('display_category_id', cr.data.map(function (c) { return c.id; }));
      if (lr.error) return [];
      return uniq((lr.data || []).map(function (r) { return r.category_id; }));
    } catch (e) { return []; }
  }

  /* A linked parent includes all descendants, exactly like storefront world
     eligibility. Conventional root slugs are a compatibility fallback for a
     store that has not configured its world links yet. */
  function isCategory(tree, categoryId, linkedIds) {
    if (!tree || categoryId == null || !tree.byId[categoryId] || !tree.isVisible(categoryId)) return false;
    var root = tree.rootOf(categoryId);
    if (root && ROOT_SLUGS[root.slug]) return true;
    var id = String(categoryId);
    return (linkedIds || []).some(function (linked) {
      if (!tree.byId[linked] || !tree.isVisible(linked)) return false;
      return tree.descendantIds(linked).some(function (x) { return String(x) === id; });
    });
  }

  function processedImage(product) {
    var a = product && product.attributes;
    return a && typeof a === 'object' ? String(a[ATTR] || '') : '';
  }

  /* Product-card and gallery renderers can use the cutout without mutating the
     real product object that cart, variant and detail logic already share. */
  function displayProduct(product) {
    var url = processedImage(product);
    return url ? Object.assign({}, product, { image_url: url }) : product;
  }

  function withProcessedImage(attrs, url) {
    var out = Object.assign({}, attrs && typeof attrs === 'object' ? attrs : {});
    if (url) out[ATTR] = url;
    else delete out[ATTR];
    return out;
  }

  Pcx.HomeDecor = {
    WORLD_SLUG: 'home',
    PROCESSED_IMAGE_ATTR: ATTR,
    linkedCategoryIds: linkedCategoryIds,
    isCategory: isCategory,
    processedImage: processedImage,
    displayProduct: displayProduct,
    withProcessedImage: withProcessedImage
  };
})(window);
