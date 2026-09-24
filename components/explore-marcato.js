/* Pcx.ExploreMarcato
 * The "Explore Marcato" destination strip: portrait cards for the specialized Marcato worlds
 * (Food, Fashion, Beauty, Home & Decor, Gifts). Distinct from categories, brands and vendors —
 * these are whole shopping experiences, not product filters.
 *
 * The worlds themselves come from the `worlds` table (Admin > Banners > Explore Marcato) through
 * Worlds.fetch() in data/worlds.js: title, description, order and on/off are all admin-managed, so this
 * component just draws whatever list it is given (an empty list draws nothing).
 *
 * Card media: `image_url` is the still picture, `gif_url` an optional animated GIF. The GIF plays on top of the
 * still (which is what shows while the GIF loads, if it fails, and for visitors who prefer reduced motion).
 * With neither, the card falls back to its gradient + icon.
 *
 *   Pcx.ExploreMarcato.mount(document.getElementById('exploreRow'), worlds, goToWorld);
 *
 * Requires: components/explore-marcato.css
 */
(function (global) {
  'use strict';

  var ARROW = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';

  function h(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function safe(u) { return global.safeHref ? global.safeHref(u) : String(u || ''); }

  function mount(root, worlds, onOpen) {
    root.textContent = '';
    if (!worlds || !worlds.length) return;

    worlds.forEach(function (w) {
      var card = h('button', 'xmCard');
      card.type = 'button';
      card.style.setProperty('--xm-grad', w.gradient);
      card.setAttribute('aria-label', w.tagline ? w.name + ' \u2014 ' + w.tagline : w.name);
      card.addEventListener('click', function () { onOpen(w.slug); });

      var art = h('span', 'xmCard-art');
      var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', w.viewBox || '0 0 24 24');
      icon.setAttribute('class', 'xmCard-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = w.icon;
      art.appendChild(icon);

      var still = w.image_url || w.gif_url;
      if (still) {
        var img = h('img', 'xmCard-img');
        img.src = safe(still);
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', function () { img.remove(); });
        card.appendChild(img);
      }
      if (w.gif_url && w.image_url) {
        var gif = h('img', 'xmCard-img xmCard-gif');
        gif.alt = '';
        gif.addEventListener('load', function () { gif.classList.add('on'); });
        gif.addEventListener('error', function () { gif.remove(); });
        gif.src = safe(w.gif_url);
        card.appendChild(gif);
      }
      card.appendChild(art);

      var body = h('span', 'xmCard-body');
      var name = h('span', 'xmCard-name'); name.textContent = w.name;
      var tag = h('span', 'xmCard-tag'); tag.textContent = w.tagline || '';
      var go = h('span', 'xmCard-go'); go.innerHTML = ARROW;
      body.appendChild(name); body.appendChild(tag);
      card.appendChild(body);
      card.appendChild(go);

      root.appendChild(card);
    });
  }

  (global.Pcx = global.Pcx || {}).ExploreMarcato = { mount: mount };
})(window);
