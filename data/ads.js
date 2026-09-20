/* Ads: data helpers for the storefront.
 *
 * An ad row (table `ads`) drives two things:
 *   1. a card inside the home product feed, placed after `after_rows` rows of products
 *   2. a brand page (components/ad-page.js) built from `page` JSON: hero, sections, contact
 *
 * page = {
 *   hero:     [{ image, href, alt }],
 *   contact:  { email, phone },
 *   sections: [
 *     { type:'products', title, layout:'rail'|'grid', mode:'auto'|'manual', ids:[], category, limit, nav },
 *     { type:'cards',    items:[{ title, image, button, product_id, href }] },
 *     { type:'banner',   image, product_id, href },
 *     { type:'video',    url },
 *     { type:'text',     title, body }
 *   ]
 * }
 */
(function (global) {
  'use strict';

  function asJSON(v, fallback) {
    if (v && typeof v === 'object') return v;
    try { return JSON.parse(v); } catch (_) { return fallback; }
  }

  function fromRow(r) {
    var page = asJSON(r.page, {}) || {};
    return {
      id: r.id,
      name: r.name || r.brand || 'Sponsored',
      brand: (r.brand || '').trim(),
      afterRows: Math.max(1, parseInt(r.after_rows, 10) || 5),
      sortOrder: parseInt(r.sort_order, 10) || 1,
      accent: r.accent || '#3f4468',
      logo: r.logo_url || '',
      feed: { image: r.feed_image || '', title: r.feed_title || '', sub: r.feed_sub || '', cta: r.feed_cta || '' },
      page: {
        hero: Array.isArray(page.hero) ? page.hero.filter(function (h) { return h && h.image; }) : [],
        sections: Array.isArray(page.sections) ? page.sections : [],
        contact: page.contact || {}
      }
    };
  }

  function list(rows) {
    return (rows || []).map(fromRow).sort(function (a, b) {
      return a.afterRows - b.afterRows || a.sortOrder - b.sortOrder;
    });
  }

  /* The card shown inside the home feed (rendered with PromotionalCarousel in single-card mode). */
  function feedPromo(ad) {
    return {
      id: 'ad-' + ad.id,
      image: ad.feed.image,
      label: 'Sponsored',
      title: ad.feed.title || ad.name,
      meta: ad.feed.sub,
      cta: ad.feed.cta || 'Shop now',
      href: '#ad=' + ad.id,
      accent: ad.accent
    };
  }

  /* cells: array of html strings, one per product. Returns a new array with an ad slot inserted after
   * `afterRows * cols` products (or at the end when there are fewer products than that). */
  function interleave(cells, ads, cols) {
    var out = cells.slice();
    var placed = [];
    ads.forEach(function (ad) {
      var at = Math.min(ad.afterRows * cols, cells.length);
      placed.push({ at: at, html: '<div class="adslot au" data-ad="' + ad.id + '" style="grid-column:1/-1"></div>' });
    });
    /* insert from the back so earlier indexes stay valid; equal positions keep list order */
    placed.map(function (p, i) { return { at: p.at, html: p.html, i: i }; })
      .sort(function (a, b) { return b.at - a.at || b.i - a.i; })
      .forEach(function (p) { out.splice(p.at, 0, p.html); });
    return out;
  }

  function productImages(p) {
    var imgs = asJSON(p.images, []);
    if (Array.isArray(imgs) && imgs.length) return imgs.filter(Boolean);
    return p.image_url ? [p.image_url] : [];
  }

  /* Which products a "products" section shows. Manual picks win; otherwise everything that belongs to the
   * ad's brand (products.brand, or the brand word inside the product name), optionally narrowed by category. */
  function productsFor(ad, section, all) {
    var out;
    var ids = (section.ids || []).map(Number);
    if (section.mode === 'manual' && ids.length) {
      var byId = {};
      all.forEach(function (p) { byId[p.id] = p; });
      out = ids.map(function (id) { return byId[id]; }).filter(Boolean);
    } else {
      var b = ad.brand.toLowerCase();
      out = b ? all.filter(function (p) {
        return (p.brand || '').toLowerCase() === b || (p.name || '').toLowerCase().indexOf(b) !== -1;
      }) : [];
      if (section.category) out = out.filter(function (p) { return p.category === section.category; });
    }
    var limit = parseInt(section.limit, 10);
    return limit > 0 ? out.slice(0, limit) : out;
  }

  global.Ads = { fromRow: fromRow, list: list, feedPromo: feedPromo, interleave: interleave, productImages: productImages, productsFor: productsFor };
})(window);
