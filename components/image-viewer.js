/* Pcx.ImageViewer
 * A true full-screen photo viewer: the photo uses the whole screen (no frame, no margins).
 *
 *   const viewer = new Pcx.ImageViewer({
 *     images: [url, url, ...],
 *     alt: 'Product name',
 *     onClose() {}
 *   });
 *   viewer.open(index);   viewer.close();
 *
 * Gestures: swipe left/right for the next photo, pinch or double-tap to zoom, drag to pan while zoomed,
 * swipe down to close. Keyboard: arrows, Escape. Thumbnails sit over the bottom edge of the photo,
 * so they never shrink it. Styles: components/product-page.css
 */
(function (global) {
  'use strict';

  var SVG_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ARROW = function (dir) {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="' + (dir < 0 ? '15 18 9 12 15 6' : '9 18 15 12 9 6') + '"/></svg>';
  };

  var MAX_ZOOM = 5, DOUBLE_TAP_ZOOM = 2.5;
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  function h(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function ImageViewer(opts) {
    this.o = Object.assign({ images: [], alt: '', onClose: null }, opts);
    this.idx = 0;
    this.z = { s: 1, x: 0, y: 0 };
    this.ptrs = new Map();
    this.mode = null;
    this.isOpen = false;
    this.lastTap = null;
  }

  var P = ImageViewer.prototype;

  P.open = function (index) {
    if (this.isOpen || !this.o.images.length) return;
    this.isOpen = true;
    this.idx = clamp(index || 0, 0, this.o.images.length - 1);
    this._build();
    document.body.appendChild(this.root);
    var self = this;
    requestAnimationFrame(function () { self.root.classList.add('is-open'); });
    this._go(this.idx, false);
    this.closeBtn.focus({ preventScroll: true });
  };

  P.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    var self = this, root = this.root;
    document.removeEventListener('keydown', this._key);
    root.classList.remove('is-open');
    setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 220);
    if (self.o.onClose) self.o.onClose();
  };

  /* ── build ───────────────────────────────────────── */

  P._build = function () {
    var self = this, imgs = this.o.images, n = imgs.length;
    var root = this.root = h('div', 'iv');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', (this.o.alt || 'Product') + ' photos');

    var stage = this.stage = h('div', 'iv__stage');
    var track = this.track = h('div', 'iv__track');
    this.imgEls = imgs.map(function (u, i) {
      var slide = h('div', 'iv__slide');
      var img = h('img', 'iv__img');
      img.alt = (self.o.alt || 'Photo') + ' ' + (i + 1) + ' of ' + n;
      img.draggable = false;
      img.decoding = 'async';
      img.src = safeHref(u);
      slide.appendChild(img);
      track.appendChild(slide);
      return img;
    });
    stage.appendChild(track);
    root.appendChild(stage);

    this.count = h('div', 'iv__count');
    root.appendChild(this.count);

    this.closeBtn = h('button', 'iv__close');
    this.closeBtn.type = 'button';
    this.closeBtn.setAttribute('aria-label', 'Close');
    this.closeBtn.innerHTML = SVG_X;
    this.closeBtn.addEventListener('click', function () { self.close(); });
    root.appendChild(this.closeBtn);

    if (n > 1) {
      var prev = h('button', 'iv__nav iv__nav--prev'), next = h('button', 'iv__nav iv__nav--next');
      prev.type = next.type = 'button';
      prev.setAttribute('aria-label', 'Previous photo'); next.setAttribute('aria-label', 'Next photo');
      prev.innerHTML = ARROW(-1); next.innerHTML = ARROW(1);
      prev.addEventListener('click', function () { self._go(self.idx - 1, true); });
      next.addEventListener('click', function () { self._go(self.idx + 1, true); });
      root.appendChild(prev); root.appendChild(next);

      var thumbs = this.thumbs = h('div', 'iv__thumbs');
      this.thumbEls = imgs.map(function (u, i) {
        var b = h('button', 'iv__thumb');
        b.type = 'button';
        b.setAttribute('aria-label', 'Show photo ' + (i + 1));
        var t = h('img'); t.alt = ''; t.src = safeHref(u); t.draggable = false;
        b.appendChild(t);
        b.addEventListener('click', function () { self._go(i, true); });
        thumbs.appendChild(b);
        return b;
      });
      root.appendChild(thumbs);
    }

    stage.addEventListener('pointerdown', function (e) { self._down(e); });
    stage.addEventListener('pointermove', function (e) { self._move(e); });
    stage.addEventListener('pointerup', function (e) { self._up(e); });
    stage.addEventListener('pointercancel', function (e) { self._up(e); });
    stage.addEventListener('wheel', function (e) { self._wheel(e); }, { passive: false });

    this._key = function (e) {
      if (e.key === 'Escape') self.close();
      else if (e.key === 'ArrowRight') self._go(self.idx + 1, true);
      else if (e.key === 'ArrowLeft') self._go(self.idx - 1, true);
    };
    document.addEventListener('keydown', this._key);
  };

  /* ── paging ──────────────────────────────────────── */

  P._go = function (i, animate) {
    var n = this.o.images.length;
    if (i < 0 || i >= n) { i = clamp(i, 0, n - 1); }
    var changed = i !== this.idx;
    this.idx = i;
    this.track.classList.toggle('is-anim', !!animate);
    this.track.classList.remove('is-drag');
    this.track.style.transform = 'translate3d(' + (-i * 100) + '%,0,0)';
    if (changed) this._resetZoom(false);
    this.count.textContent = (i + 1) + ' / ' + n;
    this.count.hidden = n < 2;
    if (this.thumbEls) {
      this.thumbEls.forEach(function (b, k) { b.classList.toggle('is-active', k === i); });
      var t = this.thumbEls[i];
      if (t && t.scrollIntoView) { try { t.scrollIntoView({ inline: 'center', block: 'nearest', behavior: animate ? 'smooth' : 'auto' }); } catch (_) {} }
    }
  };

  /* ── zoom ────────────────────────────────────────── */

  P._img = function () { return this.imgEls[this.idx]; };

  P._applyZoom = function (animate) {
    var img = this._img(), z = this.z;
    img.classList.toggle('is-anim', !!animate);
    img.style.transform = 'translate3d(' + z.x + 'px,' + z.y + 'px,0) scale(' + z.s + ')';
  };

  P._clampPan = function () {
    var z = this.z, w = this.stage.clientWidth, hgt = this.stage.clientHeight;
    var mx = (z.s - 1) * w / 2, my = (z.s - 1) * hgt / 2;
    z.x = clamp(z.x, -mx, mx);
    z.y = clamp(z.y, -my, my);
  };

  P._resetZoom = function (animate) {
    this.imgEls.forEach(function (el) { el.style.transform = ''; el.classList.remove('is-anim'); });
    this.z = { s: 1, x: 0, y: 0 };
    if (animate) this._applyZoom(true);
    this.stage.classList.remove('is-zoomed');
  };

  P._zoomAt = function (px, py, s, animate) {
    var r = this.stage.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var z = this.z, ratio = s / z.s;
    z.x = (px - cx) - ((px - cx) - z.x) * ratio;
    z.y = (py - cy) - ((py - cy) - z.y) * ratio;
    z.s = s;
    if (s <= 1.001) { z.s = 1; z.x = 0; z.y = 0; }
    this._clampPan();
    this._applyZoom(animate);
    this.stage.classList.toggle('is-zoomed', z.s > 1.001);
  };

  P._wheel = function (e) {
    e.preventDefault();
    var s = clamp(this.z.s * Math.exp(-e.deltaY * 0.0022), 1, MAX_ZOOM);
    this._zoomAt(e.clientX, e.clientY, s, false);
  };

  /* ── pointer gestures ────────────────────────────── */

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  P._down = function (e) {
    if (e.target.closest('.iv__nav, .iv__close, .iv__thumbs')) return;
    try { this.stage.setPointerCapture(e.pointerId); } catch (_) {}
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var z = this.z;
    if (this.ptrs.size === 1) {
      this.start = { x: e.clientX, y: e.clientY, t: Date.now(), tx: z.x, ty: z.y };
      this.mode = null;
    } else if (this.ptrs.size === 2) {
      var p = Array.from(this.ptrs.values());
      this.pinch = { d: dist(p[0], p[1]) || 1, s: z.s, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2, tx: z.x, ty: z.y };
      this.mode = 'pinch';
      this.track.classList.remove('is-anim');
    }
  };

  P._move = function (e) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    var z = this.z;

    if (this.mode === 'pinch' && this.ptrs.size >= 2) {
      var p = Array.from(this.ptrs.values());
      var d = dist(p[0], p[1]);
      var mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      var s = clamp(this.pinch.s * d / this.pinch.d, 1, MAX_ZOOM);
      var r = this.stage.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var ratio = s / this.pinch.s;
      z.x = (this.pinch.cx - cx) - ((this.pinch.cx - cx) - this.pinch.tx) * ratio + (mid.x - this.pinch.cx);
      z.y = (this.pinch.cy - cy) - ((this.pinch.cy - cy) - this.pinch.ty) * ratio + (mid.y - this.pinch.cy);
      z.s = s;
      this._clampPan();
      this._applyZoom(false);
      this.stage.classList.toggle('is-zoomed', z.s > 1.001);
      return;
    }
    if (this.ptrs.size !== 1 || !this.start) return;

    var dx = e.clientX - this.start.x, dy = e.clientY - this.start.y;
    if (!this.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      this.mode = z.s > 1.001 ? 'pan' : (Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'dismiss');
      if (this.mode === 'swipe') { this.track.classList.remove('is-anim'); this.track.classList.add('is-drag'); }
    }
    if (this.mode === 'pan') {
      z.x = this.start.tx + dx; z.y = this.start.ty + dy;
      this._clampPan(); this._applyZoom(false);
    } else if (this.mode === 'swipe') {
      var n = this.o.images.length, edge = (this.idx === 0 && dx > 0) || (this.idx === n - 1 && dx < 0);
      var off = edge ? dx / 3 : dx;
      this.track.style.transform = 'translate3d(calc(' + (-this.idx * 100) + '% + ' + off + 'px),0,0)';
    } else if (this.mode === 'dismiss') {
      var down = Math.max(0, dy);
      this.stage.style.transform = 'translate3d(0,' + down + 'px,0)';
      this.root.style.setProperty('--iv-fade', String(1 - Math.min(down / 320, .6)));
    }
  };

  P._up = function (e) {
    if (!this.ptrs.has(e.pointerId)) return;
    var pt = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    try { this.stage.releasePointerCapture(e.pointerId); } catch (_) {}
    var z = this.z, st = this.start;

    if (this.mode === 'pinch') {
      if (this.ptrs.size < 2) {
        if (z.s < 1.08) { this._zoomAt(0, 0, 1, true); }
        var rest = Array.from(this.ptrs.values())[0];
        if (rest) { this.start = { x: rest.x, y: rest.y, t: Date.now(), tx: z.x, ty: z.y }; this.mode = z.s > 1.001 ? 'pan' : 'done'; }
        else this.mode = null;
      }
      return;
    }
    if (this.ptrs.size > 0) return;

    var dx = pt.x - st.x, dy = pt.y - st.y, dt = Math.max(1, Date.now() - st.t);
    var mode = this.mode;
    this.mode = null;

    if (mode === 'swipe') {
      var w = this.stage.clientWidth, v = dx / dt;
      var next = this.idx;
      if (dx < -w * 0.18 || v < -0.45) next = this.idx + 1;
      else if (dx > w * 0.18 || v > 0.45) next = this.idx - 1;
      this._go(next, true);
    } else if (mode === 'dismiss') {
      if (dy > 110 || dy / dt > 0.6) { this.close(); return; }
      this.stage.style.transition = 'transform .2s ease';
      this.stage.style.transform = '';
      this.root.style.removeProperty('--iv-fade');
      var stg = this.stage;
      setTimeout(function () { stg.style.transition = ''; }, 220);
    } else if (!mode && Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 320) {
      var now = Date.now(), lt = this.lastTap;
      if (lt && now - lt.t < 320 && Math.hypot(pt.x - lt.x, pt.y - lt.y) < 40) {
        this.lastTap = null;
        this._zoomAt(pt.x, pt.y, z.s > 1.001 ? 1 : DOUBLE_TAP_ZOOM, true);
      } else this.lastTap = { t: now, x: pt.x, y: pt.y };
    }
  };

  (global.Pcx = global.Pcx || {}).ImageViewer = ImageViewer;
})(window);
