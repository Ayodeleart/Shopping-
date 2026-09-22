/* components/seller-brand.js
 * Pcx.SellerBrand — the one place that decides how a seller's identity
 * is shown next to a product ("Sold by [logo] Brand Name"). Built for
 * the /store/[slug] storefront per the "start the seller-brand
 * infrastructure" requirement, so other surfaces (product card, order
 * line, order tracking) can adopt the same markup later instead of
 * hand-rolling their own "Sold by" block.
 *
 * Never invents a name or logo: vendor === null (vendor_id is null on
 * the product) means the item is sold by the marketplace itself, and
 * `storeName` / `storeLogoUrl` (the marketplace's own identity, e.g.
 * from store_settings / store-logo.png) is shown instead — exactly the
 * fallback index.html's own product page already uses.
 *
 * Usage:
 *   Pcx.SellerBrand.chip(vendor, { storeName, storeLogoUrl, size: 28 })
 *   Pcx.SellerBrand.row(vendor, { storeName, storeLogoUrl, onView: 'viewSellerStore(1)' })
 */
(function (global) {
  'use strict';
  var ns = global.Pcx = global.Pcx || {};

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Resolves what to display for a given vendor row (or null = marketplace-owned product). */
  function identity(vendor, opts) {
    opts = opts || {};
    if (vendor && vendor.business_name) {
      return { name: vendor.business_name, logo: vendor.logo_url || null, isVendor: true };
    }
    return { name: opts.storeName || 'Store', logo: opts.storeLogoUrl || null, isVendor: false };
  }

  /* A small round avatar + name, no action — for tight spaces (product card corner, order line). */
  function chip(vendor, opts) {
    opts = opts || {};
    var id = identity(vendor, opts);
    var size = opts.size || 24;
    var letter = esc((id.name[0] || '?').toUpperCase());
    var avatar = id.logo
      ? '<img src="' + esc(id.logo) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%" ' +
        'onerror="this.parentNode.dataset.fallback=\'1\';this.remove()">'
      : '';
    return (
      '<span class="sbChip" style="display:inline-flex;align-items:center;gap:6px;min-width:0">' +
        '<span style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;overflow:hidden;flex-shrink:0;' +
          'background:var(--bg3,#ebebeb);display:flex;align-items:center;justify-content:center;font-size:' + Math.round(size * 0.45) + 'px;font-weight:800;color:var(--txt2,#555)" data-fallback="0">' +
          avatar + (id.logo ? '' : letter) +
        '</span>' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(id.name) + '</span>' +
      '</span>'
    );
  }

  /* Full "Sold by" row with a logo, name and an optional "View Store" action — used on the product page/cards. */
  function row(vendor, opts) {
    opts = opts || {};
    var id = identity(vendor, opts);
    var letter = esc((id.name[0] || '?').toUpperCase());
    var actionHTML = '';
    if (id.isVendor && opts.onView) {
      actionHTML = '<button class="sbViewBtn" onclick="' + opts.onView + '">View Store</button>';
    }
    return (
      '<div class="sbRow">' +
        '<div class="sbAvatar' + (id.logo ? ' hasLogo' : '') + '" data-l="' + letter + '">' +
          (id.logo
            ? '<img src="' + esc(id.logo) + '" alt="" onerror="this.parentNode.classList.remove(\'hasLogo\');this.replaceWith(document.createTextNode(this.parentNode.dataset.l))">'
            : letter) +
        '</div>' +
        '<div class="sbTxt"><div class="sbLbl">Sold by</div><div class="sbName">' + esc(id.name) + '</div></div>' +
        actionHTML +
      '</div>'
    );
  }

  ns.SellerBrand = { chip: chip, row: row, identity: identity };
})(window);
