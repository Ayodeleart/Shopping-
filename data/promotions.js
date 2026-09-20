/* Campaign data for the storefront hero carousel.
 * Kept apart from the component: edit this file (or the `banners` table) to change what is promoted.
 *
 * Promotion shape (see components/promotion-slide.js):
 *   { id, image, title, label, meta, cta, href, accent, alt, focus }
 */
(function (global) {
  'use strict';

  /* Hard-coded campaigns. Used only when the `banners` table has no rows.
   * Example:
   *   { id: 'weekend-deals', image: 'assets/promos/weekend-deals.jpg',
   *     title: 'Weekend deals', label: 'Ends Sunday', meta: 'Free delivery over 20,000',
   *     cta: 'Shop now', href: '/?cat=Deals', accent: '#D91C2D' },
   */
  var STATIC_PROMOTIONS = [];

  /* Maps a Supabase `banners` row to a promotion.
   * The destination comes from `target` (product page, ad page or link; see data/ads.js), or the older `link_url`. */
  function fromBanner(row) {
    return {
      id: row.id,
      image: row.image_url || '',
      title: row.title || '',
      label: row.badge || '',
      meta: row.subtitle || '',
      cta: row.cta_text || '',
      href: global.Ads ? global.Ads.bannerHref(row) : (row.link_url || row.href || ''),
      accent: row.bg_color || ''
    };
  }

  function resolve(rows) {
    var promos = (rows || []).map(fromBanner).filter(function (p) {
      return p.image || p.title || p.label || p.meta;      /* skip completely empty rows */
    });
    return promos.length ? promos : STATIC_PROMOTIONS.slice();
  }

  global.Promotions = { STATIC_PROMOTIONS: STATIC_PROMOTIONS, fromBanner: fromBanner, resolve: resolve };
})(window);
