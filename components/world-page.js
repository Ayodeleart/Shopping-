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

  /* Same icon set as the main Marcato header (#hdr in index.html) and the Fashion world, so every
     shopping-world page offers the same search/cart/profile access with identical touch targets. */
  var SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M11 6C13.7614 6 16 8.23858 16 11M16.6588 16.6549L21 21M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CART_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7.5 18C8.32843 18 9 18.6716 9 19.5C9 20.3284 8.32843 21 7.5 21C6.67157 21 6 20.3284 6 19.5C6 18.6716 6.67157 18 7.5 18Z" stroke="currentColor" stroke-width="1.5"/><path d="M16.5 18.0001C17.3284 18.0001 18 18.6716 18 19.5001C18 20.3285 17.3284 21.0001 16.5 21.0001C15.6716 21.0001 15 20.3285 15 19.5001C15 18.6716 15.6716 18.0001 16.5 18.0001Z" stroke="currentColor" stroke-width="1.5"/><path d="M2 3L2.26121 3.09184C3.5628 3.54945 4.2136 3.77826 4.58584 4.32298C4.95808 4.86771 4.95808 5.59126 4.95808 7.03836V9.76C4.95808 12.7016 5.02132 13.6723 5.88772 14.5862C6.75412 15.5 8.14857 15.5 10.9375 15.5H12M16.2404 15.5C17.8014 15.5 18.5819 15.5 19.1336 15.0504C19.6853 14.6008 19.8429 13.8364 20.158 12.3075L20.6578 9.88275C21.0049 8.14369 21.1784 7.27417 20.7345 6.69708C20.2906 6.12 18.7738 6.12 17.0888 6.12H11.0235M4.95808 6.12H7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var PROFILE_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path opacity="0.4" d="M12.1207 12.78C12.0507 12.77 11.9607 12.77 11.8807 12.78C10.1207 12.72 8.7207 11.28 8.7207 9.50998C8.7207 7.69998 10.1807 6.22998 12.0007 6.22998C13.8107 6.22998 15.2807 7.69998 15.2807 9.50998C15.2707 11.28 13.8807 12.72 12.1207 12.78Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path opacity="0.34" d="M18.7398 19.3801C16.9598 21.0101 14.5998 22.0001 11.9998 22.0001C9.39977 22.0001 7.03977 21.0101 5.25977 19.3801C5.35977 18.4401 5.95977 17.5201 7.02977 16.8001C9.76977 14.9801 14.2498 14.9801 16.9698 16.8001C18.0398 17.5201 18.6398 18.4401 18.7398 19.3801Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
    if (this.root._homeDecorCleanup) { this.root._homeDecorCleanup(); this.root._homeDecorCleanup = null; }
    document.body.style.overflow = '';
  };

  P._build = function (world) {
    var self = this, root = this.root, d = this.d, ctx = d.ctx;
    var Pcx = global.Pcx || {}, WS = Pcx.WorldSections;
    if (root._homeDecorCleanup) { root._homeDecorCleanup(); root._homeDecorCleanup = null; }
    root.textContent = '';
    root.classList.toggle('world-home', world.slug === 'home' || world.slug === 'home-decor');
    root.style.setProperty('--wp-grad', world.gradient);

    /* ONE header implementation for every world (Beauty included): built here, before any world-specific content. */
    var hdr = h('header', 'wp-hdr');
    var back = h('button', 'wp-back'); back.type = 'button'; back.setAttribute('aria-label', 'Back'); back.innerHTML = BACK;
    back.addEventListener('click', function () { d.onBack(); });
    hdr.appendChild(back); hdr.appendChild(h('span', 'wp-hdr-ttl', world.name));

    var searchBtn = h('button', 'hdr-icon'); searchBtn.type = 'button'; searchBtn.setAttribute('aria-label', 'Search'); searchBtn.innerHTML = SEARCH_ICON;
    searchBtn.addEventListener('click', function () { (d.openSearch || global.openSearch || function () {})(); });
    var cartBtn = h('button', 'hdr-icon'); cartBtn.type = 'button'; cartBtn.setAttribute('aria-label', 'Cart'); cartBtn.innerHTML = CART_ICON;
    var cartDot = h('span'); cartDot.id = 'wpCartDot'; cartBtn.appendChild(cartDot);
    cartBtn.addEventListener('click', function () { (d.openCart || global.openCart || function () {})(); });
    var profileBtn = h('button', 'hdr-icon'); profileBtn.type = 'button'; profileBtn.setAttribute('aria-label', 'Account'); profileBtn.innerHTML = PROFILE_ICON;
    var acctDot = h('span', 'hdr-dot'); acctDot.id = 'wpAcctDot'; profileBtn.appendChild(acctDot);
    profileBtn.addEventListener('click', function () { (d.openAccount || global.openAccount || function () {})(); });
    hdr.appendChild(searchBtn); hdr.appendChild(cartBtn); hdr.appendChild(profileBtn);
    root.appendChild(hdr);

    if (world.slug === 'beauty' && global.Pcx && global.Pcx.BeautyWorld) {   /* the dedicated Beauty world (components/beauty-world.js) renders UNDER the shared header */
      global.Pcx.BeautyWorld.mount(root, world, {
        onBack: d.onBack, beauty: d.beauty && d.beauty(),
        cardHTML: ctx && ctx.cardHTML, brandOf: d.brandOf, sponsored: d.sponsored, mountAds: d.mountAds
      });
      return;
    }

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
