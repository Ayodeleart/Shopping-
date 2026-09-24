/* Pcx.createSlide(promotion, index, options)
 * Builds one campaign card. Artwork comes from an image; any copy (label, title, meta, cta)
 * is optional and only rendered when supplied, so finished artwork that already contains its
 * own text can be shown untouched.
 *
 * promotion: { image, title, label, meta, cta, href, accent, alt, focus }
 *   image   URL of the banner artwork
 *   title   headline (also used for accessibility when there is a link)
 *   label   small pill above the title
 *   meta    small line under the title (dates, terms, delivery note)
 *   cta     text of the call-to-action pill
 *   href    destination (http, https, mailto, tel or a relative URL)
 *   accent  any CSS colour: loading colour, plain-card background, label pill colour
 *   alt     description of the artwork (defaults to title)
 *   focus   CSS object-position for the artwork, e.g. "left center"
 * options: { total, clone, eager, onSelect(event) }
 *
 * All text is inserted with textContent; nothing from the data is parsed as HTML.
 */
(function (global) {
  'use strict';

  var CHEVRON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function resolveHref(raw) {
    if (!raw) return null;
    try {
      var u = new URL(raw, location.href);
      if (!/^(https?:|mailto:|tel:)$/.test(u.protocol)) return null;
      return { href: u.href, external: /^https?:$/.test(u.protocol) && u.origin !== location.origin };
    } catch (_) { return null; }
  }

  function validColor(c) {
    return !!c && !!(global.CSS && CSS.supports) && CSS.supports('color', c);
  }

  /* readable text colour on top of a hex accent */
  function inkFor(c) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c || '');
    if (!m) return '#fff';
    var x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    var lum = 0.299 * parseInt(x.slice(0, 2), 16) + 0.587 * parseInt(x.slice(2, 4), 16) + 0.114 * parseInt(x.slice(4, 6), 16);
    return lum > 170 ? '#111' : '#fff';
  }

  function createSlide(p, index, o) {
    o = o || {};
    var link = resolveHref(p.href);
    var el = h('div', 'pcx__slide');
    el.dataset.index = index;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-roledescription', 'slide');
    el.setAttribute('aria-label', (index + 1) + ' of ' + (o.total || 1));
    if (o.clone) el.setAttribute('aria-hidden', 'true');

    if (validColor(p.accent)) {
      el.style.setProperty('--pcx-accent', p.accent);
      el.style.setProperty('--pcx-ink', inkFor(p.accent));
    }
    if (p.focus && /^[\w\s%.\-]+$/.test(p.focus)) el.style.setProperty('--pcx-focus', p.focus);

    if (p.image) {
      var img = new Image();
      img.className = 'pcx__img';
      img.alt = link ? '' : (p.alt || p.title || '');
      img.decoding = 'async';
      img.draggable = false;
      if (o.eager) img.fetchPriority = 'high';
      var show = function () { img.classList.add('is-loaded'); };
      img.addEventListener('load', show, { once: true });
      img.addEventListener('error', function () { img.remove(); el.classList.add('pcx__slide--plain'); }, { once: true });
      img.src = safeHref(p.image);
      if (img.complete && img.naturalWidth) show();
      el.appendChild(img);
    } else {
      el.classList.add('pcx__slide--plain');
    }

    if (p.label || p.title || p.meta || p.cta) {
      el.appendChild(h('div', 'pcx__scrim'));
      var copy = h('div', 'pcx__copy');
      if (p.label) copy.appendChild(h('span', 'pcx__label', p.label));
      if (p.title) copy.appendChild(h('span', 'pcx__title', p.title));
      if (p.meta)  copy.appendChild(h('span', 'pcx__meta', p.meta));
      if (p.cta) {
        var cta = h('span', 'pcx__cta', p.cta);
        cta.insertAdjacentHTML('beforeend', CHEVRON);
        copy.appendChild(cta);
      }
      el.appendChild(copy);
    }

    if (link) {
      var a = h('a', 'pcx__link');
      a.href = safeHref(link.href);
      a.draggable = false;
      if (link.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.setAttribute('aria-label', p.alt || [p.label, p.title, p.meta].filter(Boolean).join('. ') || 'View promotion');
      if (o.clone) a.tabIndex = -1;
      if (o.onSelect) a.addEventListener('click', o.onSelect);
      el.appendChild(a);
    }
    return el;
  }

  (global.Pcx = global.Pcx || {}).createSlide = createSlide;
})(window);
