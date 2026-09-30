/* Pcx.BrandStrip: the ONE compact "Shop by Brand" section used by category pages and every world.
 *
 * It invents nothing: brands come from the products it is given, resolved through the store's existing brand records
 * (deps.brandOf -> { id, name, logo_url }) or, when a product only has brand text, that text. A brand with no product in the
 * given list is never shown. It draws the section and reports taps; the host filters ITS OWN listing in place.
 *
 *   var strip = Pcx.BrandStrip.mount(hostEl, { products, brandOf, active: 'key' | null, cap: 20, onSelect(item | null) });
 *   strip.update(products, activeKey)      // after the host's list changes
 *   Pcx.BrandStrip.collect(products, brandOf) -> [{ key, name, logo_url, n }]   (busiest first)
 *   Pcx.BrandStrip.keyOf(product, brandOf)     -> the same key for a product (or '' when it has no brand)
 *
 * Needs: components/brand-strip.css, esc() / safeUrl() from components/product-card.js.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};
  var esc = function (v) { return global.esc ? global.esc(v) : String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var safe = function (u) { return global.safeUrl ? global.safeUrl(u) : String(u || ''); };

  function ident(p, brandOf) {
    var b = typeof brandOf === 'function' ? brandOf(p) : null;
    if (b && b.name) return { key: b.id != null ? 'id:' + b.id : 'n:' + String(b.name).toLowerCase(), name: String(b.name), logo_url: b.logo_url || null };
    var t = p && p.brand != null ? String(p.brand).trim() : '';
    return t ? { key: 'n:' + t.toLowerCase(), name: t, logo_url: null } : null;
  }
  function keyOf(p, brandOf) { var i = ident(p, brandOf); return i ? i.key : ''; }

  function collect(products, brandOf) {
    var by = {}, out = [];
    (products || []).forEach(function (p) {
      var i = ident(p, brandOf);
      if (!i) return;
      if (!by[i.key]) { by[i.key] = { key: i.key, name: i.name, logo_url: i.logo_url, n: 0 }; out.push(by[i.key]); }
      by[i.key].n++;
      if (!by[i.key].logo_url && i.logo_url) by[i.key].logo_url = i.logo_url;
    });
    return out.sort(function (a, b) { return (b.n - a.n) || a.name.localeCompare(b.name); });
  }

  function itemHTML(b, on) {
    return '<button type="button" class="bs-brand' + (on ? ' on' : '') + '" data-bs-key="' + esc(b.key) + '" aria-pressed="' + (on ? 'true' : 'false') + '" title="' + esc(b.name) + '">' +
      '<span class="bs-logo"><span class="bs-letter">' + esc(String(b.name).trim().charAt(0).toUpperCase() || '?') + '</span>' +
      (b.logo_url ? '<img src="' + safe(b.logo_url) + '" alt="" loading="lazy" decoding="async" draggable="false" onerror="this.remove()">' : '') +
      '</span><span class="bs-name">' + esc(b.name) + '</span></button>';
  }

  function mount(host, o) {
    var state = { products: o.products || [], active: o.active || null, items: [] };
    var el = document.createElement('section');
    el.className = 'bs' + (o.className ? ' ' + o.className : '');
    el.setAttribute('aria-label', 'Shop by Brand');
    host.textContent = '';
    host.appendChild(el);

    function draw() {
      var oldRow = el.querySelector('.bs-row'), sl = oldRow ? oldRow.scrollLeft : 0;   /* keep the strip where the shopper scrolled it */
      state.items = collect(state.products, o.brandOf).slice(0, o.cap || 20);
      /* a selected brand must stay visible/clearable even if it fell outside the cap */
      if (state.active && !state.items.some(function (b) { return b.key === state.active; })) {
        var keep = collect(state.products, o.brandOf).filter(function (b) { return b.key === state.active; })[0];
        if (keep) state.items.unshift(keep);
      }
      if (!state.items.length) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      el.innerHTML = '<div class="secHd secHd--accent" style="--sec-accent:#8E2DE2"><span class="secTtl">Shop by Brand</span></div>' +
        '<div class="bs-row">' + state.items.map(function (b) { return itemHTML(b, b.key === state.active); }).join('') + '</div>';
      var row = el.querySelector('.bs-row'); if (row && sl) row.scrollLeft = sl;
    }
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-bs-key]') : null;
      if (!b) return;
      var key = b.getAttribute('data-bs-key');
      var item = state.items.filter(function (x) { return x.key === key; })[0];
      if (!item) return;
      state.active = state.active === key ? null : key;      /* tapping the selected brand clears it */
      draw();
      if (o.onSelect) o.onSelect(state.active ? item : null);
    });
    draw();
    return {
      el: el,
      update: function (products, active) { state.products = products || []; if (active !== undefined) state.active = active || null; draw(); },
      setActive: function (active) { state.active = active || null; draw(); }
    };
  }

  Pcx.BrandStrip = { mount: mount, collect: collect, keyOf: keyOf };
})(window);
