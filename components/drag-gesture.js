/* Pcx.DragGesture
 * Horizontal drag for a pointer (touch, mouse, pen) with axis locking, velocity sampling
 * and click suppression after a drag.
 *
 * The element must use `touch-action: pan-y`. That keeps vertical page scrolling native:
 * the browser owns vertical pans, and this class only takes over once the movement is
 * clearly horizontal, so a swipe can never hijack the page scroll.
 *
 *   const g = new Pcx.DragGesture(el, {
 *     onStart()            // horizontal intent confirmed
 *     onMove(dx, event)    // dx = px moved since the pointer went down
 *     onEnd({ dx, vx }, cancelled)   // vx = px/ms over the last ~100ms (negative = leftwards)
 *   });
 *   g.destroy();
 */
(function (global) {
  'use strict';

  var LOCK_DISTANCE = 7;   // px of travel before the axis is decided
  var AXIS_BIAS = 1.2;     // horizontal travel must beat vertical by this factor to lock

  function DragGesture(el, handlers) {
    var id = null, x0 = 0, y0 = 0, locked = false, samples = [], suppress = false, suppressTimer = null;

    function velocity() {
      if (samples.length < 2) return 0;
      var last = samples[samples.length - 1], first = samples[0];
      for (var i = samples.length - 1; i >= 0; i--) {
        if (last.t - samples[i].t <= 100) first = samples[i]; else break;
      }
      var dt = last.t - first.t;
      return dt > 1 ? (last.x - first.x) / dt : 0;
    }

    function down(e) {
      if (id !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; locked = false;
      samples = [{ t: e.timeStamp, x: e.clientX }];
    }

    function move(e) {
      if (e.pointerId !== id) return;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (!locked) {
        if (Math.hypot(dx, dy) < LOCK_DISTANCE) return;
        if (Math.abs(dx) < Math.abs(dy) * AXIS_BIAS) { id = null; return; }   // vertical intent: hand back to the browser
        locked = true;
        try { el.setPointerCapture(id); } catch (_) {}
        handlers.onStart();
      }
      samples.push({ t: e.timeStamp, x: e.clientX });
      if (samples.length > 8) samples.shift();
      handlers.onMove(dx, e);
    }

    function finish(e, cancelled) {
      if (e.pointerId !== id) return;
      var was = locked, dx = e.clientX - x0, vx = velocity();
      id = null; locked = false; samples = [];
      if (!was) return;
      suppress = true;
      clearTimeout(suppressTimer);
      suppressTimer = setTimeout(function () { suppress = false; }, 60);
      handlers.onEnd(cancelled ? { dx: 0, vx: 0 } : { dx: dx, vx: vx }, cancelled);
    }

    function up(e) { finish(e, false); }
    function cancel(e) { finish(e, true); }
    function click(e) { if (suppress) { e.preventDefault(); e.stopPropagation(); } }
    function noDrag(e) { e.preventDefault(); }

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('click', click, true);
    el.addEventListener('dragstart', noDrag);

    this.destroy = function () {
      clearTimeout(suppressTimer);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('click', click, true);
      el.removeEventListener('dragstart', noDrag);
    };
  }

  (global.Pcx = global.Pcx || {}).DragGesture = DragGesture;
})(window);
