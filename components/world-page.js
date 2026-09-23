/* Pcx.WorldPage
 * Full-screen destination page opened from an "Explore Marcato" card (#world=slug).
 * This first version is a placeholder only — each slug (food, fashion, beauty, home, gifts) is
 * reserved as the future route for its own dedicated world, built in a later pass. It follows the
 * same slide-up-from-bottom pattern as components/category-page.js and components/ad-page.js so it
 * feels native to the app rather than a bolt-on screen.
 *
 *   const page = new Pcx.WorldPage(document.getElementById('worldPage'), { onBack, storeName: () => storeName });
 *   page.open(world);   // world = { slug, name, tagline, gradient, icon } from data/worlds.js
 *   page.close();
 *
 * Requires: components/world-page.css, data/worlds.js
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
    var self = this, root = this.root, d = this.d;
    root.textContent = '';
    root.style.setProperty('--wp-grad', world.gradient);

    var hdr = h('header', 'wp-hdr');
    var back = h('button', 'wp-back'); back.type = 'button'; back.setAttribute('aria-label', 'Back'); back.innerHTML = BACK;
    back.addEventListener('click', function () { d.onBack(); });
    var ttl = h('span', 'wp-hdr-ttl', world.name);
    hdr.appendChild(back); hdr.appendChild(ttl);
    root.appendChild(hdr);

    var hero = h('div', 'wp-hero');
    if (world.image_url) {
      var himg = h('img', 'wp-hero-img');
      himg.src = world.image_url; himg.alt = '';
      hero.appendChild(himg);
      hero.classList.add('has-img');
    }
    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', world.viewBox || '0 0 24 24'); icon.setAttribute('class', 'wp-hero-icon'); icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = world.icon;
    hero.appendChild(icon);
    var name = h('h2', 'wp-hero-name', world.name);
    var tag = h('p', 'wp-hero-tag', world.tagline);
    hero.appendChild(name); hero.appendChild(tag);
    root.appendChild(hero);

    var body = h('div', 'wp-body');
    var badge = h('span', 'wp-badge', 'Coming soon');
    var storeName = (d.storeName && d.storeName()) || 'Marcato';
    var msg = h('p', 'wp-msg', 'We\u2019re building a dedicated ' + world.name + ' experience. For now, browse everything ' + storeName + ' has to offer.');
    var cta = h('button', 'wp-cta', 'Continue shopping');
    cta.type = 'button';
    cta.addEventListener('click', function () { d.onBack(); });
    body.appendChild(badge); body.appendChild(msg); body.appendChild(cta);
    root.appendChild(body);
  };

  (global.Pcx = global.Pcx || {}).WorldPage = WorldPage;
})(window);
