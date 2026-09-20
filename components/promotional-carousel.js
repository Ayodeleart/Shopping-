/* PromotionalCarousel
 * A horizontal track of promotional cards. The active card is centred and dominant, the
 * neighbours peek in at the edges, and the whole track moves with one GPU transform.
 *
 *   const carousel = new PromotionalCarousel(document.getElementById('hero'), {
 *     promotions: [{ image, title, label, meta, cta, href, accent }],   // see promotion-slide.js
 *     autoplay: true,        // ignored when the user prefers reduced motion
 *     interval: 4500,        // ms between automatic advances
 *     duration: 700,         // ms of a programmatic slide
 *     ariaLabel: 'Promotions',
 *     variant: '',           // 'flat' = edge to edge, one card, no peek (page heroes); 'gallery' = flat + contained product photos
 *     onSelect(event, promotion, index) {}   // call event.preventDefault() to route it yourself
 *   });
 *   carousel.next(); carousel.prev(); carousel.goTo(2);
 *   carousel.setPromotions(list); carousel.destroy();
 *
 * How the loop works: with 2+ cards the track holds three identical sets of cards and the
 * active position always rests in the middle set. After every move the track is re-centred
 * on the equivalent card in the middle set without a transition. The two frames look
 * identical, so the loop is seamless in both directions and no DOM is ever rebuilt.
 *
 * Requires: drag-gesture.js, promotion-slide.js, promotional-carousel.css
 */
(function (global) {
  'use strict';

  var ns = global.Pcx = global.Pcx || {};

  var DEFAULTS = {
    promotions: [],
    autoplay: true,
    interval: 4500,
    duration: 700,
    ariaLabel: 'Promotions',
    variant: '',
    onSelect: null
  };

  var FLICK_VELOCITY = 0.35;   // px/ms: a release faster than this always advances
  var DRAG_THRESHOLD = 0.22;   // share of a card pitch: a slower release must pass this to advance
  var RELEASE_EASE = 'cubic-bezier(.2,.85,.3,1)';   // after a drag the card is already moving: no ease-in

  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var mod = function (v, n) { return ((v % n) + n) % n; };

  function h(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  var ARROW = function (dir) {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="' +
      (dir < 0 ? '15 18 9 12 15 6' : '9 18 15 12 9 6') + '"/></svg>';
  };

  function PromotionalCarousel(root, options) {
    this.root = root;
    this.o = Object.assign({}, DEFAULTS, options);
    this.pauses = new Set();
    this.off = [];
    this.timer = null; this.settleTimer = null; this.due = 0; this.remaining = 0;
    this.busy = false; this.dragging = false;
    this.pos = 0; this.x = 0; this.idx = -1; this.n = 0;
    this.reduceMq = global.matchMedia('(prefers-reduced-motion: reduce)');
    this.setPromotions(this.o.promotions);
  }

  var P = PromotionalCarousel.prototype;

  /* ── lifecycle ─────────────────────────────────────── */

  P.setPromotions = function (list) {
    this._teardown();
    this.promos = (list || []).filter(Boolean);
    this.n = this.promos.length;
    if (!this.n) { this.root.hidden = true; return; }
    this.root.hidden = false;
    this._build();
  };

  P.destroy = function () {
    this._teardown();
    this.root.hidden = true;
  };

  P._on = function (target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.off.push(function () { target.removeEventListener(type, fn, opts); });
  };

  P._teardown = function () {
    this._clearTimer();
    clearTimeout(this.settleTimer);
    this.off.forEach(function (fn) { fn(); });
    this.off = [];
    if (this.ro) { this.ro.disconnect(); this.ro = null; }
    if (this.io) { this.io.disconnect(); this.io = null; }
    if (this.gesture) { this.gesture.destroy(); this.gesture = null; }
    this.pauses.clear();
    this.busy = this.dragging = false;
    this.idx = -1;
    this.root.textContent = '';
    this.root.classList.remove('is-paused', 'is-dragging');
  };

  /* ── build ─────────────────────────────────────────── */

  P._build = function () {
    var self = this, root = this.root, n = this.n, o = this.o;
    this.sets = n > 1 ? 3 : 1;

    root.classList.add('pcx');
    root.classList.toggle('pcx--single', n < 2);
    root.classList.toggle('pcx--flat', o.variant === 'flat' || o.variant === 'gallery');
    root.classList.toggle('pcx--gallery', o.variant === 'gallery');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', 'carousel');
    root.setAttribute('aria-label', o.ariaLabel);
    root.style.setProperty('--pcx-interval', o.interval + 'ms');
    root.style.setProperty('--pcx-dur', o.duration + 'ms');

    var stage = h('div', 'pcx__stage');
    this.viewport = h('div', 'pcx__viewport');
    this.track = h('div', 'pcx__track');
    this.slides = [];

    for (var s = 0; s < this.sets; s++) {
      for (var i = 0; i < n; i++) {
        var real = this.sets === 1 || s === 1;
        var slide = ns.createSlide(this.promos[i], i, {
          total: n,
          clone: !real,
          eager: real && i === 0,
          onSelect: this._selectHandler(i)
        });
        this.slides.push(slide);
        this.track.appendChild(slide);
      }
    }
    this.viewport.appendChild(this.track);
    stage.appendChild(this.viewport);

    this.dots = [];
    if (n > 1) {
      var prev = h('button', 'pcx__nav pcx__nav--prev'), next = h('button', 'pcx__nav pcx__nav--next');
      prev.type = next.type = 'button';
      prev.setAttribute('aria-label', 'Previous promotion');
      next.setAttribute('aria-label', 'Next promotion');
      prev.innerHTML = ARROW(-1); next.innerHTML = ARROW(1);
      stage.appendChild(prev); stage.appendChild(next);
      this._on(prev, 'click', function () { self.prev(); });
      this._on(next, 'click', function () { self.next(); });

      var dots = h('div', 'pcx__dots');
      for (var d = 0; d < n; d++) {
        var b = h('button', 'pcx__dot');
        b.type = 'button';
        b.setAttribute('aria-label', 'Show promotion ' + (d + 1) + ' of ' + n);
        b.innerHTML = '<span><i></i></span>';
        (function (k) { self._on(b, 'click', function () { self.goTo(k); }); })(d);
        dots.appendChild(b);
        this.dots.push(b);
      }
      root.appendChild(stage);
      root.appendChild(dots);
    } else {
      root.appendChild(stage);
    }

    this.pos = this.sets === 3 ? n : 0;
    this._measure();
    this._setX(this.xFor(this.pos), false);
    this._setActive(this.pos);
    if (n < 2) return;

    this.gesture = new ns.DragGesture(this.viewport, {
      onStart: function () { self._dragStart(); },
      onMove: function (dx) { self._dragMove(dx); },
      onEnd: function (r) { self._dragEnd(r); }
    });

    this._on(this.track, 'transitionend', function (e) {
      if (e.target === self.track && e.propertyName === 'transform') self._settle();
    });
    this._on(root, 'keydown', function (e) {
      if (e.key === 'ArrowRight') { self.next(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { self.prev(); e.preventDefault(); }
    });
    this._on(root, 'focusin', function (e) {
      var kb = true;
      try { kb = e.target.matches(':focus-visible'); } catch (_) {}   // very old Safari has no :focus-visible
      if (kb) self._pause('focus');
    });
    this._on(root, 'focusout', function () { self._resume('focus'); });
    if (global.matchMedia('(hover: hover)').matches) {
      this._on(root, 'mouseenter', function () { self._pause('hover'); });
      this._on(root, 'mouseleave', function () { self._resume('hover'); });
    }
    this._on(document, 'visibilitychange', function () {
      document.hidden ? self._pause('hidden') : self._resume('hidden');
    });
    if (this.reduceMq.addEventListener) this._on(this.reduceMq, 'change', function () { self._applyMotionPref(); });

    if ('ResizeObserver' in global) {
      this.ro = new ResizeObserver(function () { self._onResize(); });
      this.ro.observe(this.viewport);
    } else {
      this._on(global, 'resize', function () { self._onResize(); });
    }
    if ('IntersectionObserver' in global) {
      this.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { e.isIntersecting ? self._resume('offscreen') : self._pause('offscreen'); });
      }, { threshold: 0.4 });
      this.io.observe(root);
    }

    this._applyMotionPref();
  };

  P._selectHandler = function (index) {
    var self = this;
    return function (event) {
      if (self.o.onSelect) self.o.onSelect(event, self.promos[index], index);
    };
  };

  /* ── geometry ──────────────────────────────────────── */

  P._measure = function () {
    var s = this.slides;
    if (!s.length || !s[0].offsetWidth) return false;
    this.vw = this.viewport.clientWidth;
    this.sw = s[0].offsetWidth;
    this.pitch = s.length > 1 ? s[1].offsetLeft - s[0].offsetLeft : 0;
    this.base = (this.vw - this.sw) / 2 - s[0].offsetLeft;
    return true;
  };

  P.xFor = function (pos) { return this.base - pos * this.pitch; };

  P._nearest = function (x) {
    return clamp(Math.round((this.base - x) / (this.pitch || 1)), 0, this.sets * this.n - 1);
  };

  P._setX = function (x, animate, ms, ease) {
    var st = this.track.style;
    st.transitionDuration = animate && !this.reduced ? ms + 'ms' : '0ms';
    st.transitionTimingFunction = ease || '';
    st.transform = 'translate3d(' + x + 'px,0,0)';
    this.x = x;
  };

  P._currentX = function () {
    var t = getComputedStyle(this.track).transform;
    if (!t || t === 'none') return this.x;
    var M = global.DOMMatrixReadOnly || global.WebKitCSSMatrix;
    return new M(t).m41;
  };

  P._onResize = function () {
    if (!this._measure() || this.dragging) return;
    this._setX(this.xFor(this.pos), false);
  };

  /* ── navigation ────────────────────────────────────── */

  P.next = function () { this.go(1); };
  P.prev = function () { this.go(-1); };

  P.go = function (delta) {
    if (this.n < 2 || this.dragging) return;
    var t = this.pos + delta;
    if (t < 1 || t > this.sets * this.n - 2) return;   // safety while a move is still in flight
    this._commit(t, this.o.duration);
  };

  P.goTo = function (i) {
    if (this.n < 2 || this.dragging) return;
    var d = i - mod(this.pos, this.n);
    if (d > this.n / 2) d -= this.n; else if (d < -this.n / 2) d += this.n;
    if (!d) return;
    var t = clamp(this.pos + d, 1, this.sets * this.n - 2);
    this._commit(t, Math.min(900, this.o.duration + 90 * (Math.abs(d) - 1)));
  };

  P._commit = function (target, ms, ease) {
    var self = this;
    this.pos = target;
    this._setActive(target);
    this._setX(this.xFor(target), true, ms, ease);
    this.busy = true;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(function () { self._settle(); }, ms + 80);
    this._restartCycle();
  };

  P._settle = function () {
    clearTimeout(this.settleTimer);
    if (this.dragging) return;
    this.busy = false;
    this._normalize();
  };

  /* Re-centre on the equivalent card in the middle set. Identical content, so it is invisible. */
  P._normalize = function () {
    if (this.sets === 1) return;
    var n = this.n, p = this.pos;
    if (p < n) p += n; else if (p >= 2 * n) p -= n; else return;
    this.pos = p;
    this._setX(this.xFor(p), false);
  };

  P._setActive = function (pos) {
    var idx = mod(pos, this.n);
    if (idx === this.idx) return;
    this.idx = idx;
    for (var i = 0; i < this.slides.length; i++)
      this.slides[i].classList.toggle('is-active', +this.slides[i].dataset.index === idx);
    for (var d = 0; d < this.dots.length; d++) {
      this.dots[d].classList.toggle('is-active', d === idx);
      if (d === idx) this.dots[d].setAttribute('aria-current', 'true'); else this.dots[d].removeAttribute('aria-current');
    }
  };

  /* ── dragging ──────────────────────────────────────── */

  P._dragStart = function () {
    this.dragging = true;
    this.root.classList.add('is-dragging');
    this._pause('drag');
    clearTimeout(this.settleTimer);
    this.busy = false;
    /* freeze at the exact visual position, then shift into the middle set so the drag has room both ways */
    var x = this._currentX();
    var p = Math.round((this.base - x) / this.pitch), shift = 0;
    if (p < this.n) shift = this.n; else if (p >= 2 * this.n) shift = -this.n;
    this.pos = p + shift;
    this.dragX0 = x - shift * this.pitch;
    this._setX(this.dragX0, false);
  };

  P._dragMove = function (dx) {
    var lim = this.pitch * 1.2;
    var x = this.dragX0 + clamp(dx, -lim, lim);
    this._setX(x, false);
    this._setActive(this._nearest(x));
  };

  P._dragEnd = function (r) {
    this.dragging = false;
    this.root.classList.remove('is-dragging');
    var d = 0;
    if (Math.abs(r.vx) > FLICK_VELOCITY) d = r.vx < 0 ? 1 : -1;
    else if (Math.abs(r.dx) > this.pitch * DRAG_THRESHOLD) d = r.dx < 0 ? 1 : -1;
    var t = clamp(this.pos + d, 1, this.sets * this.n - 2);
    var dist = Math.abs(this.xFor(t) - this.x);
    var ms = clamp(dist / Math.max(Math.abs(r.vx), 0.75), 340, 640);
    this._resume('drag');
    this._commit(t, ms, RELEASE_EASE);
  };

  /* ── autoplay ──────────────────────────────────────── */

  P._applyMotionPref = function () {
    this.reduced = this.reduceMq.matches;
    this.autoOn = this.o.autoplay && !this.reduced && this.n > 1;
    this.root.classList.toggle('pcx--rm', this.reduced);
    this.root.classList.toggle('pcx--static', !this.autoOn);
    if (this.autoOn) this._restartCycle(); else this._clearTimer();
  };

  P._arm = function (ms) {
    var self = this;
    this._clearTimer();
    if (!this.autoOn || this.pauses.size) return;
    this.due = performance.now() + ms;
    this.timer = setTimeout(function () { self.timer = null; self.go(1); }, ms);
  };

  P._clearTimer = function () { clearTimeout(this.timer); this.timer = null; };

  /* a new cycle starts with every move: the timer and the indicator's progress fill restart together */
  P._restartCycle = function () {
    this.remaining = this.o.interval;
    var dot = this.dots[this.idx];
    if (dot) {
      var bar = dot.querySelector('i');
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    }
    this._arm(this.remaining);
  };

  P._pause = function (reason) {
    if (this.pauses.has(reason)) return;
    if (this.timer) { this.remaining = Math.max(0, this.due - performance.now()); this._clearTimer(); }
    this.pauses.add(reason);
    this.root.classList.add('is-paused');
  };

  P._resume = function (reason) {
    if (!this.pauses.delete(reason) || this.pauses.size) return;
    this.root.classList.remove('is-paused');
    this._arm(this.remaining || this.o.interval);
  };

  Object.defineProperty(P, 'index', { get: function () { return this.idx; } });

  ns.Carousel = global.PromotionalCarousel = PromotionalCarousel;
})(window);
