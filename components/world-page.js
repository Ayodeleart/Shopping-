/* Pcx.WorldPage
 * Full-screen destination page opened from an "Explore Marcato" card (#world=slug). It is the same page for every
 * world: header, then the world's hero, its display categories and its products, all loaded from the world's
 * configuration (see components/world-sections.js). A world may add extra sections of its own by registering a
 * renderer in Pcx.WorldExtensions[slug] (the Food world does this in components/food-world.js). A world with nothing
 * configured yet shows a plain "coming soon" page. It follows the same slide-up-from-bottom pattern as
 * components/category-page.js and components/ad-page.js.
 *
 *   const page = new Pcx.WorldPage(document.getElementById('worldPage'), { onBack, storeName: () => storeName, ctx });
 *   page.open(world);   // world = { slug, name, tagline, gradient, icon } from data/worlds.js
 *   page.close();
 *
 *   ctx = the getters described in components/world-sections.js (sb, tree, products, cardHTML, vendors, ...)
 *
 * Requires: components/world-page.css, components/world-sections.js/.css, data/worlds.js
 */
(function (global) {
  'use strict';

  var BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function WorldPage(root, deps) {
    this.root = root;
    this.d = deps;
    this.world = null;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-hidden', 'true');
  }

  var P = WorldPage.prototype;

  P.isOpen = function () { return this.root.classList.contains('open'); };

  P.open = function (world) {
    if (!world) return;
    if (this.world && this.world.slug === world.slug && this.isOpen()) return;
    this.world = world;
    this._build(world);
    this.root.scrollTop = 0;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  P.close = function () {
    if (!this.isOpen()) return;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  P._build = function (world) {
    var self = this, root = this.root, d = this.d, ctx = d.ctx;
    var Pcx = global.Pcx || {}, WS = Pcx.WorldSections;
    root.textContent = '';
    root.style.setProperty('--wp-grad', world.gradient);

    var hdr = h('header', 'wp-hdr');
    var back = h('button', 'wp-back'); back.type = 'button'; back.setAttribute('aria-label', 'Back'); back.innerHTML = BACK;
    back.addEventListener('click', function () { d.onBack(); });
    hdr.appendChild(back); hdr.appendChild(h('span', 'wp-hdr-ttl', world.name));
    root.appendChild(hdr);

    var body = h('div', 'ws-root');
    root.appendChild(body);
    body.appendChild(h('div', 'ws-loading', 'Loading\u2026'));

    var token = this._tok = (this._tok || 0) + 1;      // a slow response for a world you already left must not draw over the next one
    var extra = (Pcx.WorldExtensions || {})[world.slug];
    function draw(config) {
      if (token !== self._tok) return;
      body.textContent = '';
      if (extra) extra(body, world, config, ctx);
      else WS.renderWorld(body, world, config, ctx);
    }
    WS.load(ctx.sb, world.slug)
      .then(draw)
      .catch(function (e) { draw({ heroes: [], cats: [], error: String((e && e.message) || e), missing: false }); });
  };

  (global.Pcx = global.Pcx || {}).WorldPage = WorldPage;
})(window);
