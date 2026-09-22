/* Pcx.ExploreMarcato
 * The "Explore Marcato" destination strip: portrait cards for the specialized Marcato worlds
 * (Food, Fashion, Beauty, Home, Gifts). Distinct from categories, brands and vendors — these are
 * whole shopping experiences, not product filters. Data comes from data/worlds.js (static for now).
 *
 *   Pcx.ExploreMarcato.mount(document.getElementById('exploreRow'), Worlds.list(), goToWorld);
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

  function mount(root, worlds, onOpen) {
    root.textContent = '';
    if (!worlds || !worlds.length) return;

    worlds.forEach(function (w) {
      var card = h('button', 'xmCard');
      card.type = 'button';
      card.style.setProperty('--xm-grad', w.gradient);
      card.setAttribute('aria-label', w.name + ' \u2014 ' + w.tagline);
      card.addEventListener('click', function () { onOpen(w.slug); });

      var art = h('span', 'xmCard-art');
      var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('class', 'xmCard-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = w.icon;
      art.appendChild(icon);
      card.appendChild(art);

      var body = h('span', 'xmCard-body');
      var name = h('span', 'xmCard-name'); name.textContent = w.name;
      var tag = h('span', 'xmCard-tag'); tag.textContent = w.tagline;
      var go = h('span', 'xmCard-go'); go.innerHTML = ARROW;
      body.appendChild(name); body.appendChild(tag);
      card.appendChild(body);
      card.appendChild(go);

      root.appendChild(card);
    });
  }

  (global.Pcx = global.Pcx || {}).ExploreMarcato = { mount: mount };
})(window);
