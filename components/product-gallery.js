/* Pcx.ProductGallery
 * The photo carousel at the top of the product page. Swipes natively (scroll-snap), rotates by itself,
 * and tapping a photo calls onOpen(index) so the page can open the full-screen viewer.
 *
 *   const gallery = new Pcx.ProductGallery(el, {
 *     images: [url, ...],
 *     alt: 'Product name',
 *     autoplay: true,        // ignored when the user prefers reduced motion
 *     interval: 4000,        // ms between automatic slides
 *     onOpen(index) {}
 *   });
 *   gallery.pause(); gallery.play(); gallery.currentImage(); gallery.destroy();
 *
 * The rotation stops while a finger is on the photos or the viewer is open, and picks up again a few
 * seconds after the last touch. Styles: components/product-page.css
 */
(function (global) {
  'use strict';

  var ARROW = function (dir) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="' + (dir < 0 ? '15 18 9 12 15 6' : '9 18 15 12 9 6') + '"/></svg>';
  };

  function h(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function ProductGallery(root, opts) {
    this.root = root;
    this.o = Object.assign({ images: [], alt: '', autoplay: true, interval: 4000, onOpen: null }, opts);
    this.idx = 0;
    this.holds = {};
    this.rt = {};          // one release timer per hold reason, so they never cancel each other
    this.timer = null;
    this.off = [];
    this._build();
  }

  var P = ProductGallery.prototype;

  P._on = function (target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.off.push(function () { target.removeEventListener(type, fn, opts); });
  };

  P._build = function () {
    var self = this, imgs = this.o.images, n = imgs.length, root = this.root;
    root.textContent = '';
    root.classList.add('pgal');
    if (!n) {
      var ph = h('div', 'pgal__empty');
      ph.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
      root.appendChild(ph);
      return;
    }

    var track = this.track = h('div', 'pgal__track');
    track.setAttribute('role', 'region');
    track.setAttribute('aria-roledescription', 'carousel');
    track.setAttribute('aria-label', (this.o.alt || 'Product') + ' photos');
    this.slides = imgs.map(function (u, i) {
      var s = h('div', 'pgal__slide');
      s.setAttribute('role', 'group');
      s.setAttribute('aria-label', (i + 1) + ' of ' + n);
      var img = h('img', 'pgal__img');
      img.alt = (self.o.alt || 'Product') + (n > 1 ? ' - photo ' + (i + 1) : '');
      img.decoding = 'async';
      img.draggable = false;
      if (i === 0) img.fetchPriority = 'high'; else img.loading = 'lazy';
      img.src = u;
      s.appendChild(img);
      s.addEventListener('click', function () { if (self.o.onOpen) self.o.onOpen(i); });
      track.appendChild(s);
      return s;
    });
    root.appendChild(track);

    if (n > 1) {
      var prev = h('button', 'pgal__nav pgal__nav--prev'), next = h('button', 'pgal__nav pgal__nav--next');
      prev.type = next.type = 'button';
      prev.setAttribute('aria-label', 'Previous photo'); next.setAttribute('aria-label', 'Next photo');
      prev.innerHTML = ARROW(-1); next.innerHTML = ARROW(1);
      this._on(prev, 'click', function () { self.go(self.idx - 1 < 0 ? n - 1 : self.idx - 1); self._nudge(); });
      this._on(next, 'click', function () { self.go((self.idx + 1) % n); self._nudge(); });
      root.appendChild(prev); root.appendChild(next);

      var dots = this.dotsEl = h('div', 'pgal__dots');
      this.dots = imgs.map(function (_, i) {
        var d = h('button', 'pgal__dot');
        d.type = 'button';
        d.setAttribute('aria-label', 'Show photo ' + (i + 1));
        d.addEventListener('click', function () { self.go(i); self._nudge(); });
        dots.appendChild(d);
        return d;
      });
      root.appendChild(dots);
      this._paintDots();

      // follow the finger / programmatic scroll: the settled slide is the current one
      var t = null;
      this._on(track, 'scroll', function () {
        clearTimeout(t);
        t = setTimeout(function () {
          var w = track.clientWidth || 1;
          var i = Math.max(0, Math.min(n - 1, Math.round(track.scrollLeft / w)));
          if (i !== self.idx) { self.idx = i; self._paintDots(); }
        }, 60);
      }, { passive: true });

      // a finger on the photos stops the rotation
      this._on(track, 'pointerdown', function () { self._hold('touch'); });
      this._on(track, 'pointerup', function () { self._release('touch', 5000); });
      this._on(track, 'pointercancel', function () { self._release('touch', 5000); });
      this._on(document, 'visibilitychange', function () { document.hidden ? self._hold('hidden') : self._release('hidden', 800); });
      this._on(global, 'resize', function () { self.go(self.idx, true); });

      this.play();
    }
  };

  P._paintDots = function () {
    var i = this.idx;
    this.dots.forEach(function (d, k) { d.classList.toggle('is-active', k === i); });
  };

  P.go = function (i, instant) {
    var n = this.o.images.length;
    if (!this.track || !n) return;
    i = ((i % n) + n) % n;
    this.idx = i;
    this._paintDots && this.dots && this._paintDots();
    var w = this.track.clientWidth;
    this.track.scrollTo({ left: i * w, behavior: instant || this._reduced() ? 'auto' : 'smooth' });
  };

  P.currentImage = function () {
    var s = this.slides && this.slides[this.idx];
    return s ? s.querySelector('img') : null;
  };

  /* ── rotation ────────────────────────────────────── */

  P._reduced = function () {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  P.play = function () {
    this._clearTimer();
    if (!this.o.autoplay || this._reduced() || this.o.images.length < 2) return;
    var self = this;
    this.timer = setInterval(function () {
      if (Object.keys(self.holds).length) return;
      self.go((self.idx + 1) % self.o.images.length);
    }, this.o.interval);
  };

  P._clearTimer = function () { if (this.timer) { clearInterval(this.timer); this.timer = null; } };

  P._hold = function (why) { clearTimeout(this.rt[why]); this.holds[why] = 1; };

  P._release = function (why, delay) {
    var self = this;
    clearTimeout(this.rt[why]);
    this.rt[why] = setTimeout(function () { delete self.holds[why]; }, delay || 0);
  };

  /* pause for the viewer, resume when it closes */
  P.pause = function () { this._hold('viewer'); };
  P.resume = function () { this._release('viewer', 2500); };

  /* a manual tap on an arrow or dot gives the reader a moment before the next automatic slide */
  P._nudge = function () { this._hold('nudge'); this._release('nudge', 5000); };

  P.destroy = function () {
    this._clearTimer();
    Object.keys(this.rt).forEach(function (k) { clearTimeout(this.rt[k]); }, this);
    this.off.forEach(function (fn) { fn(); });
    this.off = [];
    this.root.textContent = '';
    this.root.classList.remove('pgal');
  };

  (global.Pcx = global.Pcx || {}).ProductGallery = ProductGallery;
})(window);
