/* Pcx.TileRow
 * A row of square tiles (looping GIFs or still images) with a caption underneath, like the row under a
 * store's hero banner. Each tile opens its target: a brand page, a product page (30% off, skincare...),
 * an ad page or a link. The admin manages them under Banners > Tiles; data/ads.js builds the tile list.
 *
 *   Pcx.TileRow.mount(document.getElementById('tileRow'), Ads.tileList(rows));
 *
 * Four tiles fit the width; more scroll sideways. Users who prefer reduced motion get the first frame
 * of each GIF instead of the animation.
 */
(function (global) {
  'use strict';

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function safeHref(raw) {
    if (!raw) return null;
    if (raw.charAt(0) === '#') return raw;
    try {
      var u = new URL(raw, location.href);
      if (!/^(https?:|mailto:|tel:)$/.test(u.protocol)) return null;
      return { href: u.href, external: /^https?:$/.test(u.protocol) && u.origin !== location.origin };
    } catch (_) { return null; }
  }

  function still(img, alt) {
    /* draw the first frame; a canvas can be displayed even for cross-origin images (it is only read-back that is blocked) */
    var c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    try { c.getContext('2d').drawImage(img, 0, 0); } catch (_) { return; }
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', alt || '');
    img.replaceWith(c);
  }

  function mount(root, tiles) {
    root.textContent = '';
    root.hidden = !tiles.length;
    if (!tiles.length) return;
    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var wrap = h('div', 'tiles' + (tiles.length < 4 ? ' tiles--few' : ''));

    tiles.forEach(function (t) {
      var link = safeHref(t.href);
      var el = h(link ? 'a' : 'div', 'tile');
      if (link) {
        if (typeof link === 'string') el.href = link;
        else { el.href = link.href; if (link.external) { el.target = '_blank'; el.rel = 'noopener noreferrer'; } }
        el.setAttribute('aria-label', t.caption || 'Open');
      }
      var box = h('span', 'tile__img');
      var img = new Image();
      img.alt = t.caption || ''; img.decoding = 'async'; img.draggable = false;
      if (reduced) img.addEventListener('load', function () { still(img, t.caption); }, { once: true });
      img.src = t.image;
      box.appendChild(img);
      el.appendChild(box);
      if (t.caption) el.appendChild(h('span', 'tile__cap', t.caption));
      wrap.appendChild(el);
    });
    root.appendChild(wrap);
  }

  (global.Pcx = global.Pcx || {}).TileRow = { mount: mount };
})(window);
