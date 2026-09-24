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
 *     { type:'products', title, layout:'rail'|'grid', mode:'auto'|'manual', ids:[], nav,
 *       // auto mode = every product that matches ALL of the filters below (no filters = all products)
 *       categoryId (a category and its subcategories) or category (names, comma separated), keyword, discountMin,
 *       priceMax, flag:'flash'|'featured', sort:'discount'|'price_asc'|'price_desc', limit },
 *     { type:'cards',    items:[{ title, image, button, product_id, href }] },
 *     { type:'banner',   image, product_id, href },
 *     { type:'video',    url },
 *     { type:'text',     title, body }
 *   ]
 * }
 *
 * Hero banners (table `banners`) and square tiles (table `tiles`) can open a page too. Their `target` is
 *   { type:'brand', brand_id, brand }                    every product of a brand (logo on the page)
 *   { type:'collection', title, rule:{...filters above} } e.g. discountMin 30 -> everything 30% off or more
 *   { type:'products', title, ids }                       products picked by hand
 *   { type:'ad', id }                                     an ad page
 *   { type:'url', url }
 * The first three become the same page structure as an ad (campaignFromTarget), opened at #promo=ID (banner)
 * or #tile=ID (tile) and rendered by components/ad-page.js.
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

  /* cells: array of html strings, one per product. `slots` are things to drop into the feed: ads
   * ({ id, afterRows }) or any { afterRows, html, order }. Each goes after `afterRows * cols` products
   * (or at the end when there are fewer products than that). */
  function interleave(cells, slots, cols) {
    var out = cells.slice();
    slots.map(function (sl, i) {
      var at = Math.min((sl.afterRows || 0) * cols, cells.length);
      var html = sl.html || '<div class="adslot au" data-ad="' + esc(sl.id) + '" style="grid-column:1/-1"></div>';
      return { at: at, html: html, i: i, order: sl.order || 0 };
    })
      /* insert from the back so earlier indexes stay valid; equal positions keep list order */
      .sort(function (a, b) { return b.at - a.at || b.order - a.order || b.i - a.i; })
      .forEach(function (p) { out.splice(p.at, 0, p.html); });
    return out;
  }

  function productImages(p) {
    var imgs = asJSON(p.images, []);
    if (Array.isArray(imgs) && imgs.length) return imgs.filter(Boolean);
    return p.image_url ? [p.image_url] : [];
  }

  /* The storefront and admin give this a function (categoryId) -> (product) -> boolean, built from the category tree,
   * so a main category also matches its subcategories. Without it a category id is compared with product.category_id. */
  var categoryResolver = null;
  function setCategoryResolver(fn) { categoryResolver = fn; }

  function discountOf(p) {
    return p.original_price && Number(p.original_price) > Number(p.price)
      ? Math.round((1 - Number(p.price) / Number(p.original_price)) * 100) : 0;
  }

  function terms(v) {
    return String(v == null ? '' : v).split(',').map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
  }

  /* Products that match ALL the filters that are set. category / keyword take several comma separated values
   * (any of them matches). No filters at all means every product. */
  function matchRule(all, rule) {
    var r = rule || {};
    var brands = terms(r.brand), cats = terms(r.category), keys = terms(r.keyword), brandId = r.brandId ? String(r.brandId) : '';
    var minDisc = parseFloat(r.discountMin) || 0, maxPrice = parseFloat(r.priceMax) || 0;
    var catMatch = r.categoryId ? (categoryResolver && categoryResolver(r.categoryId)) || function (p) { return String(p.category_id) === String(r.categoryId); } : null;
    var out = all.filter(function (p) {
      var name = (p.name || '').toLowerCase();
      if (brandId || brands.length) {
        var byId = brandId && String(p.brand_id) === brandId;
        var byName = brands.some(function (b) { return (p.brand || '').toLowerCase() === b || name.indexOf(b) !== -1; });
        if (!byId && !byName) return false;
      }
      if (catMatch && !catMatch(p)) return false;
      if (cats.length && cats.indexOf((p.category || '').trim().toLowerCase()) === -1) return false;
      if (keys.length) {
        var hay = [p.name, p.brand, p.category, p.description].join(' ').toLowerCase();
        if (!keys.some(function (k) { return hay.indexOf(k) !== -1; })) return false;
      }
      if (minDisc && discountOf(p) < minDisc) return false;
      if (maxPrice && Number(p.price) > maxPrice) return false;
      if (r.flag === 'flash' && !p.flash_sale) return false;
      if (r.flag === 'featured' && !p.featured) return false;
      return true;
    });
    if (r.sort === 'discount') out = out.slice().sort(function (a, b) { return discountOf(b) - discountOf(a); });
    else if (r.sort === 'price_asc') out = out.slice().sort(function (a, b) { return Number(a.price) - Number(b.price); });
    else if (r.sort === 'price_desc') out = out.slice().sort(function (a, b) { return Number(b.price) - Number(a.price); });
    var limit = parseInt(r.limit, 10);
    return limit > 0 ? out.slice(0, limit) : out;
  }

  /* Which products a "products" section shows. Manual picks win; otherwise the section's filters plus the
   * ad's brand keyword. */
  function productsFor(ad, section, all) {
    var ids = (section.ids || []).map(Number);
    if (section.mode === 'manual' && ids.length) {
      var byId = {};
      all.forEach(function (p) { byId[p.id] = p; });
      var picked = ids.map(function (id) { return byId[id]; }).filter(Boolean);
      var lim = parseInt(section.limit, 10);
      return lim > 0 ? picked.slice(0, lim) : picked;
    }
    return matchRule(all, {
      brand: ad.brand, brandId: section.brandId, categoryId: section.categoryId, category: section.category, keyword: section.keyword, discountMin: section.discountMin,
      priceMax: section.priceMax, flag: section.flag, sort: section.sort, limit: section.limit
    });
  }

  /* ── banners and tiles that open a page ──
   * target: { type:'collection', title, rule } | { type:'brand', brand_id, brand } | { type:'products', title, ids }
   *       | { type:'ad', id } | { type:'url', url }
   * kind is 'promo' (hero banner) or 'tile' (square GIF tile); it names the page: #promo=ID / #tile=ID. */

  function targetOf(row) {
    var t = asJSON(row.target, null);
    if (t && t.type) return t;
    var link = row.link_url || row.href;
    return link ? { type: 'url', url: link } : null;
  }

  function targetHref(kind, row, t) {
    if (!t) return '';
    if (t.type === 'ad') return t.id ? '#ad=' + t.id : '';
    if (t.type === 'url') return t.url || '';
    return '#' + kind + '=' + row.id;
  }

  /* A collection / brand / chosen-products target becomes an ad-style page, so it renders with components/ad-page.js. */
  function campaignFromTarget(kind, row, t, ctx) {
    if (!t || ['collection', 'brand', 'products'].indexOf(t.type) === -1) return null;
    var title = t.title || row.title || row.caption || 'Deals';
    var camp = {
      id: kind + '-' + row.id, name: title, brand: '',
      tagline: kind === 'promo' ? (row.subtitle || '') : '',
      afterRows: 0, sortOrder: 0, accent: row.bg_color || '#3f4468', logo: '', feed: {},
      page: { hero: kind === 'promo' && row.image_url ? [{ image: row.image_url, alt: title }] : [], contact: {}, sections: [] }
    };
    var sec = { type: 'products', title: title, layout: 'grid', mode: 'auto', nav: false, showEmpty: true };
    if (t.type === 'collection') {
      Object.assign(sec, t.rule || {});
    } else if (t.type === 'brand') {
      var b = ctx && ctx.brandsById && ctx.brandsById[t.brand_id];
      var name = (b && b.name) || t.brand || 'Brand';
      camp.name = t.title || name; camp.brand = name; camp.logo = (b && b.logo_url) || '';
      sec.title = 'All ' + name + ' products'; sec.brandId = t.brand_id;
    } else {
      sec.mode = 'manual'; sec.ids = (t.ids || []).map(Number);
    }
    camp.page.sections = [sec];
    return camp;
  }

  /* hero banners (kept for the earlier names) */
  function bannerTarget(row) { return targetOf(row); }
  function bannerHref(row) { return targetHref('promo', row, targetOf(row)); }
  function campaignFromBanner(row, ctx) { return campaignFromTarget('promo', row, targetOf(row), ctx); }

  /* square tiles under the hero (or inside the feed) */
  function tileList(rows) {
    return (rows || []).map(function (r) {
      var t = targetOf(r);
      return {
        id: r.id, image: r.image_url || '', caption: r.caption || '', target: t,
        place: r.place === 'rows' ? 'rows' : 'hero', afterRows: Math.max(1, parseInt(r.after_rows, 10) || 5),
        order: parseInt(r.sort_order, 10) || 1, href: targetHref('tile', r, t), row: r
      };
    }).filter(function (t) { return t.image; }).sort(function (a, b) { return a.order - b.order; });
  }

  global.Ads = {
    fromRow: fromRow, list: list, feedPromo: feedPromo, interleave: interleave, productImages: productImages,
    productsFor: productsFor, matchRule: matchRule, discountOf: discountOf,
    bannerTarget: bannerTarget, bannerHref: bannerHref, campaignFromBanner: campaignFromBanner,
    targetOf: targetOf, targetHref: targetHref, campaignFromTarget: campaignFromTarget, tileList: tileList,
    setCategoryResolver: setCategoryResolver
  };
})(window);
