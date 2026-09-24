/* Pcx.MacFab: MAC, the floating mascot button (3D).
 *
 * MAC is a solid object, not a flat picture. The head is a sphere, the face, eyes and sunglasses are wrapped
 * onto its surface, the ears are cups on its sides, and everything is projected every frame, so when MAC turns
 * around you really see the side of its head, then the back of it, then the front again.
 *
 * Drag it anywhere; on release it hops to the nearest side edge (left or right), so it never sits in the middle
 * of the screen. Its side and height are remembered on this device.
 *
 * It mounts itself when the script loads. To control it yourself, set `window.MAC_FAB_MANUAL = true` first:
 *
 *   const mac = new Pcx.MacFab({ size: 60, onTap(mac) {}, onChange(state) {} });
 *
 * Gestures
 *   tap          MAC hops and fires the cancelable `mac:tap` event. mac-chat.js listens for it and opens the chat.
 *                Without the chat, MAC shows a small greeting bubble instead.
 *   drag         moves MAC; on release it snaps to the left or right edge
 *   long-press   MAC shows off: turns around, nods and puts its sunglasses on (they come off again by themselves)
 *   keyboard     Tab to focus, Enter / Space = tap, arrow keys move it
 *
 * Methods
 *   mac.hop()  mac.turnAround()  mac.nod()          one-shot moves. nod() puts the sunglasses on; they auto-remove
 *   mac.set('bounce' | 'head' | 'around' | 'bend', true | false)     continuous moves
 *   mac.toggle(name)     mac.glasses(true | false)  (true = they stay on until you turn them off)
 *   mac.say(text, ms)  mac.show()  mac.hide()  mac.state()  mac.destroy()
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  var TAU = Math.PI * 2, PI = Math.PI;
  var PERIOD = 0.85;                 // seconds per hop
  var JUMP = 120;                    // hop height, in drawing units
  var REF_W = 244, REF_H = 456;                    // the original design canvas: every drawing coordinate (head at 200,180, etc.) is relative to this
  /* MAC's motion genuinely paints outside that canvas — up to ~140 units above it at the peak of a bounce, ~55
     units either side during a turn (measured directly by sweeping every animation state and reading back each
     part's real rendered position). Relying on CSS overflow:visible for that is what caused the clipping: it
     isn't honored the same way everywhere, and a moving robot is the wrong place to find that out. So the actual
     <svg> viewBox below is padded well past the measured worst case, and the container is scaled up to match —
     REF_W/REF_H stay the reference for that scaling, so `size` still means the same on-screen size as before. */
  var PAD_L = 70, PAD_R = 75, PAD_T = 170, PAD_B = 15;
  var VB_X = 78 - PAD_L, VB_Y = 22 - PAD_T, VB_W = REF_W + PAD_L + PAD_R, VB_H = REF_H + PAD_T + PAD_B;
  var R = 106, RY = 92, K = RY / R;  // head: sphere of radius R, squashed vertically to RY
  var FX = 1.06;                     // face features are drawn a touch wider than the flat design
  var EAR_PHI = (180 - 183) / RY;
  var uid = 0;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function f(n) { return n.toFixed(1); }

  /* ---- outlines in the flat design's coordinates; they get wrapped onto the head every frame ---- */
  function rrect(x, y, w, h, r, ne, nc) {
    var q = typeof r === 'number' ? [r, r, r, r] : r, pts = [];
    function edge(x1, y1, x2, y2) { for (var i = 0; i < ne; i++) { var t = i / ne; pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); } }
    function arc(cx, cy, rad, a0, a1) { for (var i = 0; i <= nc; i++) { var a = a0 + (a1 - a0) * i / nc; pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]); } }
    edge(x + q[0], y, x + w - q[1], y);         arc(x + w - q[1], y + q[1], q[1], -PI / 2, 0);
    edge(x + w, y + q[1], x + w, y + h - q[2]); arc(x + w - q[2], y + h - q[2], q[2], 0, PI / 2);
    edge(x + w - q[2], y + h, x + q[3], y + h); arc(x + q[3], y + h - q[3], q[3], PI / 2, PI);
    edge(x, y + h - q[3], x, y + q[0]);         arc(x + q[0], y + q[0], q[0], PI, PI * 1.5);
    return pts;
  }
  function circ(cx, cy, r, n) {
    var pts = [];
    for (var i = 0; i < n; i++) { var a = TAU * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }
  function line(x1, y1, x2, y2, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
    return pts;
  }
  var VISOR = rrect(130, 148, 140, 64, 32, 10, 8);
  var EYES = [circ(170, 179, 15, 18), circ(230, 179, 15, 18)];
  var LENSES = [rrect(136, 154, 62, 48, [4, 4, 24, 24], 8, 7), rrect(202, 154, 62, 48, [4, 4, 24, 24], 8, 7)];
  var BRIDGE = rrect(194, 155, 12, 7, 2, 4, 2);
  var GLINTS = [line(160, 163, 148, 187, 4), line(170, 163, 164, 175, 3), line(240, 163, 228, 187, 4), line(250, 163, 244, 175, 3)];

  var BODY_D = 'M146 320 C146 304 170 300 200 300 C230 300 254 304 254 320 C254 378 232 450 200 450 C168 450 146 378 146 320 Z';
  function bodyHW(y) { return 54 * Math.sqrt(Math.max(0, 1 - Math.pow((y - 320) / 130, 2))); }

  function buildSVG(u) {
    return [
      '<svg viewBox="' + VB_X + ' ' + VB_Y + ' ' + VB_W + ' ' + VB_H + '" aria-hidden="true" focusable="false">',
      '<defs>',
        '<radialGradient id="' + u + 'h" cx=".32" cy=".24" r=".62"><stop offset="0" stop-color="#fff" stop-opacity=".36"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
        '<radialGradient id="' + u + 's" cx=".38" cy=".3" r=".85"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>',
      '</defs>',
      '<ellipse data-p="shadow" class="macSh" cx="200" cy="466" rx="72" ry="9" opacity=".14"/>',
      '<g data-p="robot">',
        '<g data-p="head">',
          '<g data-p="earsBack"></g>',
          '<rect class="mi" x="188" y="262" width="24" height="56"/>',
          '<rect class="mp" x="188" y="283" width="24" height="3"/><rect class="mp" x="188" y="292" width="24" height="3"/>',
          '<ellipse data-p="headE" class="mi mh" cx="200" cy="180" rx="106" ry="92"/>',
          '<path data-p="visor" class="mp"/>',
          '<path data-p="eyes" class="mi"/>',
          '<g data-p="glasses" style="display:none" opacity="0">',
            '<path data-p="arms" class="mline" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
            '<path data-p="lens" class="mi"/><path data-p="bridge" class="mi"/>',
            '<path data-p="glint" class="mpline" fill="none" stroke-width="5" stroke-linecap="round" opacity=".7"/>',
          '</g>',
          '<path data-p="vents" class="mpline" fill="none" stroke-width="5" stroke-linecap="round"/>',
          '<ellipse data-p="headHL" cx="200" cy="180" rx="106" ry="92" fill="url(#' + u + 'h)"/>',
          '<ellipse data-p="headSH" cx="200" cy="180" rx="106" ry="92" fill="url(#' + u + 's)"/>',
          '<ellipse data-p="gloss" cx="160" cy="118" rx="34" ry="11" fill="#fff" opacity=".16"/>',
          '<g data-p="ant"><line data-p="stem" class="mline" stroke-width="6" stroke-linecap="round"/><circle data-p="ball" class="mi mh macBall" r="14"/></g>',
          '<g data-p="earsFront"></g>',
        '</g>',
        '<g data-p="body">',
          '<path class="mi mh" d="' + BODY_D + '"/>',
          '<text data-p="l0" class="mp macTxt" text-anchor="middle">M</text>',
          '<text data-p="l1" class="mp macTxt" text-anchor="middle">A</text>',
          '<text data-p="l2" class="mp macTxt" text-anchor="middle">C</text>',
          '<ellipse data-p="port" class="mp"/>',
          '<path data-p="grill" class="mpline" fill="none" stroke-width="4" stroke-linecap="round"/>',
          '<path d="' + BODY_D + '" fill="url(#' + u + 'h)"/><path d="' + BODY_D + '" fill="url(#' + u + 's)"/>',
        '</g>',
      '</g>',
      '</svg>'
    ].join('');
  }

  /* nod: down, half-up, down again, hold, up (a clear "yes") */
  function nodProfile(n) {
    if (n < 0.22) return smooth(n / 0.22);
    if (n < 0.38) return 1 - 0.75 * smooth((n - 0.22) / 0.16);
    if (n < 0.56) return 0.25 + 0.75 * smooth((n - 0.38) / 0.18);
    if (n < 0.72) return 1;
    return 1 - smooth((n - 0.72) / 0.28);
  }

  var BIG_MOVES = ['bounce', 'head', 'around', 'bend'];       // the continuous moves MAC shuffles through
  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function MacFab(opts) {
    var o = this.o = {
      size: 60, margin: 10, side: 'right', y: 0.72,
      storageKey: 'mac-fab-pos',
      showcase: true,          // keep at least one move going at all times, shuffled, so MAC never sits still
      showcaseMin: 2200, showcaseMax: 4200,      // how long each move plays before MAC switches to the next
      hideWhenCovered: true,   // hide while a full-screen page/drawer is open over the store
      glassesMs: 4500,         // glasses put on by a nod come off by themselves after this long
      greeting: 'Hi, I\u2019m MAC',
      parent: document.body,
      onTap: null, onChange: null
    };
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];

    this.on = { bounce: false, head: false, around: false, bend: false, glasses: false };
    this.s = {
      t: 0, phase: 0, lagH: 0, ampHead: 0, ampBend: 0, spinA: 0, nodN: -1, nodMode: null, autoOffT: 0,
      shakeN: -1, shakeA: 0,
      ant: { x: 0, v: 0 }, landSign: 1, gy: -110, gv: 0, gTarget: -110,
      glanceT: 0, glanceDir: 0, vx: 0, dragTilt: 0, prevYaw: 0, prevTilt: 0,
      nextBlink: 2, blinkStart: -10, joy: false, earLayer: [null, null]
    };
    this.side = o.side === 'left' ? 'left' : 'right';
    this.fy = o.y;
    this.cur = { x: 0, y: 0 };
    this.dragging = false;
    this.pd = null;
    this.reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this._raf = 0; this._last = 0; this._queue = [];
    var self = this;
    this._bound = function (now) { self._frame(now); };

    this._load();
    this._build();
    this._place(false);
    this._bind();
    if (o.hideWhenCovered) this._watchCoverage();
    this._scheduleShowcase();
    this._wake();
  }
  var P = MacFab.prototype;

  /* ---------- build / bind ---------- */
  P._build = function () {
    var o = this.o;
    var el = this.el = document.createElement('div');
    el.className = 'macFab';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'MAC, your shopping helper');
    el.style.width = (o.size * VB_W / REF_W) + 'px';   // container is padded; scaled up so the character itself still renders at `size`
    el.innerHTML = buildSVG('mac' + (++uid)) + '<div class="macFab-bubble" role="status" aria-live="polite"></div>';
    this.bubble = el.querySelector('.macFab-bubble');
    var parts = this.p = {}, nodes = el.querySelectorAll('[data-p]');
    for (var i = 0; i < nodes.length; i++) parts[nodes[i].getAttribute('data-p')] = nodes[i];

    /* the two ear cups are created here so they can swap between "behind the head" and "in front of it" */
    var NS = 'http://www.w3.org/2000/svg';
    this.ears = [];
    for (var e = 0; e < 2; e++) {
      var g = document.createElementNS(NS, 'g'), rect = document.createElementNS(NS, 'rect'), ring = document.createElementNS(NS, 'ellipse');
      rect.setAttribute('class', 'mi mh'); rect.setAttribute('height', 50);
      ring.setAttribute('class', 'mpline'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke-width', 3); ring.setAttribute('ry', 17);
      g.appendChild(rect); g.appendChild(ring);
      parts.earsBack.appendChild(g);
      this.ears.push({ g: g, rect: rect, ring: ring, layer: 0 });
    }

    var probe = this._probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    o.parent.appendChild(probe);
    o.parent.appendChild(el);
  };

  P._bind = function () {
    var self = this, el = this.el;

    el.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      self.pd = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: self.cur.x, oy: self.cur.y, moved: false, long: false, lx: e.clientX, lt: performance.now() };
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      clearTimeout(self._lp);
      self._lp = setTimeout(function () {
        if (self.pd && !self.pd.moved) { self.pd.long = true; self._showOff(); }
      }, 550);
    });

    el.addEventListener('pointermove', function (e) {
      var pd = self.pd;
      if (!pd || e.pointerId !== pd.id) return;
      var dx = e.clientX - pd.x, dy = e.clientY - pd.y;
      if (!pd.moved) {
        if (Math.sqrt(dx * dx + dy * dy) < 6) return;
        pd.moved = true; self.dragging = true;
        clearTimeout(self._lp); clearTimeout(self._snapT);
        el.classList.add('isDragging'); el.classList.remove('isSnapping');
        self.hideBubble();
        self._wake();
      }
      var b = self._bounds();
      self.cur.x = clamp(pd.ox + dx, 0, b.W - b.w);
      self.cur.y = clamp(pd.oy + dy, b.minY - 30, b.maxY);
      el.style.transform = 'translate3d(' + self.cur.x.toFixed(1) + 'px,' + self.cur.y.toFixed(1) + 'px,0)';
      var now = performance.now(), dtm = now - pd.lt;
      if (dtm > 0) self.s.vx = self.s.vx * 0.7 + ((e.clientX - pd.lx) / dtm * 1000) * 0.3;
      pd.lx = e.clientX; pd.lt = now;
    });

    function up(e) {
      var pd = self.pd;
      if (!pd || e.pointerId !== pd.id) return;
      clearTimeout(self._lp);
      self.pd = null;
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (pd.moved) {
        self.dragging = false; self.s.vx = 0;
        el.classList.remove('isDragging');
        self._release();
      } else if (!pd.long && e.type === 'pointerup') {
        self._tap();
      }
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    el.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); self._tap(); return; }
      var moved = true;
      if (k === 'ArrowLeft') self.side = 'left';
      else if (k === 'ArrowRight') self.side = 'right';
      else if (k === 'ArrowUp') self.fy = clamp(self.fy - 0.08, 0, 1);
      else if (k === 'ArrowDown') self.fy = clamp(self.fy + 0.08, 0, 1);
      else moved = false;
      if (moved) { e.preventDefault(); self._place(true); self._save(); self.hop(); }
    });
    el.addEventListener('click', function (e) { if (e.detail === 0) self._tap(); });   // assistive tech

    this._onResize = function () { self._place(false); };
    global.addEventListener('resize', this._onResize);
    global.addEventListener('orientationchange', this._onResize);
  };

  /* ---------- position ---------- */
  P._bounds = function () {
    var w = this.el.offsetWidth || (this.o.size * VB_W / REF_W), h = this.el.offsetHeight || Math.round(w * VB_H / VB_W);
    var cs = getComputedStyle(this._probe);
    var ins = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    var hh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hh')) || 0;
    var W = document.documentElement.clientWidth || global.innerWidth, H = global.innerHeight, m = this.o.margin;
    var minY = ins.t + hh + m + 36;          // headroom so hops never touch the header
    var maxY = Math.max(minY, H - ins.b - h - m);
    return { w: w, h: h, W: W, H: H, minX: ins.l + m, maxX: Math.max(ins.l + m, W - ins.r - w - m), minY: minY, maxY: maxY };
  };

  P._place = function (animate) {
    var b = this._bounds(), el = this.el;
    this.cur.x = this.side === 'left' ? b.minX : b.maxX;
    this.cur.y = b.minY + clamp(this.fy, 0, 1) * (b.maxY - b.minY);
    el.classList.toggle('isLeft', this.side === 'left');
    el.classList.toggle('isRight', this.side === 'right');
    clearTimeout(this._snapT);
    if (animate) {
      el.classList.add('isSnapping');
      this._snapT = setTimeout(function () { el.classList.remove('isSnapping'); }, 500);
    } else el.classList.remove('isSnapping');
    el.style.transform = 'translate3d(' + this.cur.x.toFixed(1) + 'px,' + this.cur.y.toFixed(1) + 'px,0)';
  };

  P._release = function () {
    var b = this._bounds(), self = this;
    this.side = (this.cur.x + b.w / 2) < b.W / 2 ? 'left' : 'right';
    this.fy = b.maxY > b.minY ? clamp((this.cur.y - b.minY) / (b.maxY - b.minY), 0, 1) : 0.5;
    this._place(true);
    this._save();
    setTimeout(function () {
      self.hop();
      self.s.glanceDir = self.side === 'left' ? 1 : -1;   // glance toward the middle of the screen
      self.s.glanceT = 1.4;
      self._wake();
    }, 280);
  };

  P._load = function () {
    try {
      var v = JSON.parse(localStorage.getItem(this.o.storageKey) || 'null');
      if (v && (v.side === 'left' || v.side === 'right') && typeof v.fy === 'number') { this.side = v.side; this.fy = clamp(v.fy, 0, 1); }
    } catch (_) {}
  };
  P._save = function () {
    try { localStorage.setItem(this.o.storageKey, JSON.stringify({ side: this.side, fy: +this.fy.toFixed(3) })); } catch (_) {}
  };

  /* ---------- actions ---------- */
  P._emit = function () { if (typeof this.o.onChange === 'function') this.o.onChange(this.state()); };
  P.state = function () { var s = {}; for (var k in this.on) s[k] = this.on[k]; return s; };
  P.hop = function () {
    if (!this.on.bounce && this.s.phase === 0) this.s.phase = 1e-6;
    this._wake();
  };
  P.turnAround = function () {
    if (this.s.spinA === 0) this.s.spinA = 1e-4;
    this._wake();
  };
  /* mode: 'on' puts the glasses on at the bottom of the nod, 'off' takes them off, null just nods.
     Default: put them on if they are off. */
  P.nod = function (mode) {
    this.s.nodN = 0;
    this.s.nodMode = mode === undefined ? (this.on.glasses ? null : 'on') : mode;
    this._wake();
  };
  /* a quick side-to-side "no": takes the glasses off (does nothing if they are already off) */
  P.shakeHead = function () {
    if (!this.on.glasses) return;
    this.s.shakeN = 0;
    this._wake();
  };
  P.glasses = function (v) {
    v = !!v;
    this.s.nodMode = null; this.s.autoOffT = 0;      // a manual choice stays until you change it
    if (this.on.glasses === v) return;
    this.on.glasses = v;
    this._wake(); this._emit();
  };
  P.set = function (name, v) {
    if (name === 'glasses') { this.glasses(v); return; }
    if (!(name in this.on)) return;
    v = !!v;
    if (this.on[name] === v) return;
    this.on[name] = v;
    if (name === 'bounce' && !v) this.s.phase = this.s.phase % 1;      // finish the hop in progress, then rest
    if (name === 'bend' && v) this.nod('on');                          // the first nod puts the glasses on
    this._wake(); this._emit();
  };
  P.toggle = function (name) { this.set(name, !this.on[name]); };

  P.say = function (text, ms) {
    var b = this.bubble, self = this;
    b.textContent = text;
    b.classList.add('on');
    clearTimeout(this._bt);
    this._bt = setTimeout(function () { self.hideBubble(); }, ms || 2400);
  };
  P.hideBubble = function () { this.bubble.classList.remove('on'); clearTimeout(this._bt); };
  P.show = function () { this.el.classList.remove('isHidden'); this._place(false); this._wake(); };
  P.hide = function () { this.el.classList.add('isHidden'); };

  P._tap = function () {
    var cancelled = false;
    this.hop();
    if (typeof this.o.onTap === 'function' && this.o.onTap(this) === false) cancelled = true;
    try {
      var ev = new CustomEvent('mac:tap', { cancelable: true, detail: { mac: this } });
      if (!global.dispatchEvent(ev)) cancelled = true;
    } catch (_) {}
    if (!cancelled && this.o.greeting) this.say(this.o.greeting);
  };

  P._showOff = function () {
    if (this.on.glasses) this.shakeHead();
    else this.nod('on');
    this.turnAround();
  };

  /* MAC never just sits there: it shuffles through bounce / turn head / turn around / bend neck, always exactly one
     playing, and works a nod-glasses-on / shake-glasses-off into the mix so the shades come and go too. Dragging
     pauses it (see pointerdown/_release below); a hidden or covered MAC still runs, ready the moment it reappears. */
  P._scheduleShowcase = function () {
    var self = this;
    clearTimeout(this._showT);
    if (!this.o.showcase) return;
    if (!this._queue.length) this._queue = shuffled(BIG_MOVES);
    var next = this._queue.shift();
    var speed = this.reduce ? 1.6 : 1;      // reduced-motion: same moves, calmer pace, never fully still
    if (!this.dragging) {
      for (var i = 0; i < BIG_MOVES.length; i++) if (BIG_MOVES[i] !== next) this.on[BIG_MOVES[i]] = false;
      this.on[next] = true;
      if (Math.random() < 0.4) { if (this.on.glasses) this.shakeHead(); else this.nod('on'); }
      this._wake(); this._emit();
    }
    var dur = (this.o.showcaseMin + Math.random() * (this.o.showcaseMax - this.o.showcaseMin)) * speed;
    this._showT = setTimeout(function () { self._scheduleShowcase(); }, dur);
  };

  /* hide while a full-screen page or drawer covers the store, including MAC's own chat once it opens
     (they all lock body scroll to do it, so watching that one style property covers every case) */
  P._watchCoverage = function () {
    var self = this;
    var sync = function () { self.el.classList.toggle('isCovered', document.body.style.overflow === 'hidden'); };
    this._coverObserver = new MutationObserver(sync);
    this._coverObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    sync();
  };

  P.destroy = function () {
    cancelAnimationFrame(this._raf); this._raf = 0; this.destroyed = true;
    clearTimeout(this._showT); clearTimeout(this._lp); clearTimeout(this._bt); clearTimeout(this._snapT);
    if (this._coverObserver) this._coverObserver.disconnect();
    global.removeEventListener('resize', this._onResize);
    global.removeEventListener('orientationchange', this._onResize);
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    if (this._probe.parentNode) this._probe.parentNode.removeChild(this._probe);
  };

  /* ---------- animation loop (sleeps when MAC is at rest) ---------- */
  P._wake = function () {
    if (this._raf || this.destroyed) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._bound);
  };

  P._busy = function () {
    var on = this.on, s = this.s;
    return this.dragging || on.bounce || on.head || on.around || on.bend ||
      s.phase > 0 || s.spinA > 0 || s.nodN >= 0 || s.shakeN >= 0 || s.autoOffT > 0 || s.ampHead > 0.003 || s.ampBend > 0.003 || s.glanceT > 0 ||
      Math.abs(s.gy - s.gTarget) > 0.4 || Math.abs(s.gv) > 0.4 ||
      Math.abs(s.ant.x) > 0.25 || Math.abs(s.ant.v) > 1 || Math.abs(s.lagH) > 0.1 ||
      Math.abs(s.dragTilt) > 0.2 || (s.t - s.blinkStart) < 0.16 || s.nextBlink <= 0;
  };

  P._frame = function (now) {
    var dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this._tick(dt);
    if (this._busy() && !document.hidden) this._raf = requestAnimationFrame(this._bound);
    else this._raf = 0;
  };

  P._land = function () { this.s.ant.v += 240 * (this.s.landSign *= -1); };

  P._tick = function (dt) {
    var on = this.on, s = this.s, p = this.p;
    s.t += dt;

    /* ---- bounce: a hop is a parabola; squash on the ground, stretch in the air ---- */
    var H = 0, sq = 0, air = 0;
    if (on.bounce || s.phase > 0) {
      var before = s.phase % 1;
      s.phase += dt / PERIOD;
      if (!on.bounce && s.phase >= 1) { s.phase = 0; this._land(); }
      else if (s.phase % 1 < before) this._land();
      if (s.phase > 0) {
        var ph = s.phase % 1;
        H = 4 * ph * (1 - ph) * JUMP;
        sq = Math.max(0, 1 - Math.min(ph, 1 - ph) / 0.14);
        air = Math.sin(Math.PI * ph);
      }
    }

    /* ---- turn around: the whole body rotates about its vertical axis (a slow pause when it faces front) ---- */
    if (on.around || s.spinA > 0) {
      s.spinA += 4.2 * (0.3 + 0.7 * Math.sin((s.spinA % TAU) / 2)) * dt;
      if (s.spinA >= TAU) { s.spinA -= TAU; if (!on.around) s.spinA = 0; }
    }

    /* ---- nod: a clear double "yes"; the glasses go on / off at the bottom of the second dip ---- */
    var nodP = 0;
    if (s.nodN >= 0) {
      s.nodN += dt / 1.5;
      if (s.nodN >= 1) { s.nodN = -1; s.nodMode = null; }
      else {
        nodP = nodProfile(s.nodN);
        if (s.nodMode && s.nodN > 0.5) {
          if (s.nodMode === 'on') { on.glasses = true; s.autoOffT = this.o.glassesMs / 1000; }
          else { on.glasses = false; s.autoOffT = 0; }
          s.nodMode = null; this._emit();
        }
      }
    }
    if (s.autoOffT > 0 && on.glasses) {
      s.autoOffT -= dt;
      if (s.autoOffT <= 0) { s.autoOffT = 0; this.shakeHead(); }   // the glasses take themselves off with a shake
    }

    /* ---- shake head: a quick, decaying "no" that takes the glasses off partway through ---- */
    var shakeYaw = 0;
    if (s.shakeN >= 0) {
      s.shakeN += dt / 0.7;
      if (s.shakeN >= 1) s.shakeN = -1;
      else {
        var sp = 1 - smooth(s.shakeN);
        shakeYaw = Math.sin(s.shakeN * TAU * 2.5) * 0.5 * sp;
        if (on.glasses && s.shakeN > 0.3) { on.glasses = false; this._emit(); }
      }
    }

    /* ---- head turn / neck bend ---- */
    s.ampHead += ((on.head ? 1 : 0) - s.ampHead) * (1 - Math.exp(-dt * 4));
    var yawHead = Math.tanh(2.2 * Math.sin(s.t * 1.5)) / Math.tanh(2.2) * s.ampHead * 0.95 + shakeYaw;
    if (s.glanceT > 0) { yawHead += s.glanceDir * 0.6 * Math.min(1, s.glanceT / 0.6); s.glanceT -= dt; }
    s.ampBend += ((on.bend ? 1 : 0) - s.ampBend) * (1 - Math.exp(-dt * 4));
    s.dragTilt += ((this.dragging ? clamp(s.vx * 0.02, -25, 25) : 0) - s.dragTilt) * (1 - Math.exp(-dt * 10));
    var tilt = Math.sin(s.t * 1.9) * 16 * s.ampBend + s.dragTilt;              // roll, in degrees
    var pitch = nodP * 0.46 + Math.sin(s.t * 3.8) * 0.12 * s.ampBend;          // forward bow, in radians

    var yawBody = s.spinA + yawHead * 0.25;
    var yawH = s.spinA + yawHead;

    /* ---- whole-robot squash & stretch and the floor shadow ---- */
    var sy = 1 - 0.16 * sq + 0.07 * air - 0.03 * nodP + (this.dragging ? 0.05 : 0);
    var sx = 1 + 0.12 * sq - 0.04 * air + 0.02 * nodP - (this.dragging ? 0.03 : 0);
    p.robot.setAttribute('transform', 'translate(0 ' + f(-H) + ') translate(200 450) scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ') translate(-200 -450)');
    var sh = clamp(1 - H / 300, 0.3, 1);
    p.shadow.setAttribute('rx', f(72 * sh * (1 + 0.1 * sq)));
    p.shadow.setAttribute('opacity', (0.16 * clamp(1 - H / 240, 0.2, 1)).toFixed(3));

    s.lagH += (H - s.lagH) * (1 - Math.exp(-dt * 13));       // the head trails the body a little
    var headDy = (H - s.lagH) * 0.4 - Math.abs(Math.sin(s.t * 1.9)) * 5 * s.ampBend;
    p.head.setAttribute('transform', 'translate(0 ' + f(headDy) + ') rotate(' + tilt.toFixed(2) + ' 200 308)');

    /* ================= 3D: head ================= */
    var cyw = Math.cos(yawH), syw = Math.sin(yawH), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cyHead = 180 + RY * (1 - cp);                          // the head drops a little as it bows

    /* a point on the head (longitude lam, latitude phi, radius factor rr) -> [screenX, screenY, visible, depth] */
    function proj(lam, phi, rr, raw) {
      var r = R * rr, cph = Math.cos(phi);
      var x = r * cph * Math.sin(lam), y = r * Math.sin(phi), z = r * cph * Math.cos(lam);
      var x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;     // turn
      var y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;        // bow
      var vis = z2 >= 0;
      if (!vis && !raw) {                                      // behind the head: slide the point out to the edge
        var d = Math.sqrt(x1 * x1 + y2 * y2) || 1;
        x1 = x1 / d * R; y2 = y2 / d * R;
      }
      return [200 + x1, cyHead - y2 * K, vis, z2];
    }
    function face(px, py, rr, dy) {
      return proj((px - 200) / R * FX, clamp((180 - (py + dy)) / RY, -1.3, 1.3), rr);
    }
    function ring(pts, rr, dy) {
      var d = '', any = false;
      for (var i = 0; i < pts.length; i++) {
        var q = face(pts[i][0], pts[i][1], rr, dy);
        if (q[2]) any = true;
        d += (i ? 'L' : 'M') + f(q[0]) + ' ' + f(q[1]);
      }
      return any ? d + 'Z' : '';
    }
    function strokes(lists, rr, dy, needAll) {                 // open lines, drawn only where they face us
      var d = '';
      for (var j = 0; j < lists.length; j++) {
        var pts = lists[j], run = false, seg = '', okAll = true;
        for (var i = 0; i < pts.length; i++) {
          var q = face(pts[i][0], pts[i][1], rr, dy);
          if (!q[2]) { okAll = false; run = false; continue; }
          seg += (run ? 'L' : 'M') + f(q[0]) + ' ' + f(q[1]); run = true;
        }
        if (!needAll || okAll) d += seg;
      }
      return d;
    }
    function setD(el, d) { el.setAttribute('d', d); el.style.display = d ? '' : 'none'; }

    /* head silhouette, shading, gloss (they sink with the bow) */
    var i2;
    var hs = ['headE', 'headHL', 'headSH'];
    for (i2 = 0; i2 < 3; i2++) p[hs[i2]].setAttribute('cy', f(cyHead));
    p.gloss.setAttribute('transform', 'translate(0 ' + f(cyHead - 180) + ') rotate(-28 160 118)');

    /* face: visor and eyes wrapped on the surface */
    setD(p.visor, ring(VISOR, 1.002, 0));
    var eyeSq = 1 - 0.35 * nodP;
    if (s.t > s.nextBlink) { s.blinkStart = s.t; s.nextBlink = s.t + 2 + Math.random() * 3; }
    var bd = s.t - s.blinkStart;
    if (bd >= 0 && bd < 0.14) eyeSq *= 1 - 0.9 * Math.sin(Math.PI * bd / 0.14);
    var eyeD = '';
    for (i2 = 0; i2 < 2; i2++) {
      var e = EYES[i2], cyE = 179, sqE = [];
      for (var k = 0; k < e.length; k++) sqE.push([e[k][0], cyE + (e[k][1] - cyE) * eyeSq]);
      eyeD += ring(sqE, 1.004, 0);
    }
    setD(p.eyes, eyeD);

    /* back of the head: three vent slots */
    /* vents are drawn straight in (lam, phi) so they sit on the back (lam = PI) */
    var vd = '';
    for (i2 = 0; i2 < 3; i2++) {
      var run = false, phi = (180 - (163 + i2 * 17)) / RY;
      for (var m = 0; m <= 10; m++) {
        var qv = proj(PI + (-0.5 + m / 10), phi, 1.002);
        if (!qv[2]) { run = false; continue; }
        vd += (run ? 'L' : 'M') + f(qv[0]) + ' ' + f(qv[1]); run = true;
      }
    }
    setD(p.vents, vd);

    /* sunglasses: sit slightly off the face, with arms that run back along the head */
    s.gTarget = on.glasses ? 0 : -110;
    s.gv += (220 * (s.gTarget - s.gy) - 16 * s.gv) * dt;
    s.gy += s.gv * dt;
    var go = clamp((s.gy + 110) / 50, 0, 1);
    if (go < 0.01 && !on.glasses) p.glasses.style.display = 'none';
    else {
      p.glasses.style.display = '';
      p.glasses.setAttribute('opacity', go.toFixed(2));
      var gdy = s.gy, RG = 1.035;
      setD(p.lens, ring(LENSES[0], RG, gdy) + ring(LENSES[1], RG, gdy));
      setD(p.bridge, ring(BRIDGE, RG, gdy));
      var arms = '';
      for (var sd = -1; sd <= 1; sd += 2) {
        var run2 = false, phiA = clamp((180 - (157 + gdy)) / RY, -1.3, 1.3);
        for (var a = 0; a <= 7; a++) {
          var qa = proj(sd * (0.66 + a * 0.13), phiA, RG);
          if (!qa[2]) { run2 = false; continue; }
          arms += (run2 ? 'L' : 'M') + f(qa[0]) + ' ' + f(qa[1]); run2 = true;
        }
      }
      setD(p.arms, arms);
      setD(p.glint, strokes(GLINTS, RG + 0.004, gdy, true));
    }

    /* antenna: foreshortens as the head bows; a spring wobbles it when MAC lands, turns or is dragged */
    var baseY = 272 - (RY + 88) * cp, ballY = 272 - (RY + 136) * cp;
    p.stem.setAttribute('x1', 200); p.stem.setAttribute('x2', 200);
    p.stem.setAttribute('y1', f(baseY)); p.stem.setAttribute('y2', f(ballY));
    p.ball.setAttribute('cx', 200); p.ball.setAttribute('cy', f(ballY));
    var yawVel = (yawH - s.prevYaw) / Math.max(dt, 0.001), tiltVel = (tilt - s.prevTilt) / Math.max(dt, 0.001);
    s.prevYaw = yawH; s.prevTilt = tilt;
    if (Math.abs(yawVel) > 40) yawVel = 0;                     // ignore the wrap at a full turn
    var ant = s.ant;
    ant.v += (-170 * ant.x - 7 * ant.v - yawVel * 14 - tiltVel * 1.4) * dt;
    ant.x = clamp(ant.x + ant.v * dt, -38, 38);
    p.ant.setAttribute('transform', 'rotate(' + ant.x.toFixed(2) + ' 200 ' + f(baseY) + ')');

    /* ears: cups on the sides of the head; the far one goes behind, the near one comes in front */
    for (i2 = 0; i2 < 2; i2++) {
      var side = i2 === 0 ? -1 : 1, E = this.ears[i2];
      var lp = side * PI / 2 + yawH, cl = Math.cos(lp), sl = Math.sin(lp);
      var c = proj(side * PI / 2, EAR_PHI, 107 / R, true);
      var w = 26 * Math.abs(sl) + 50 * Math.abs(cl);
      E.rect.setAttribute('x', f(c[0] - w / 2)); E.rect.setAttribute('y', f(c[1] - 25));
      E.rect.setAttribute('width', f(w));
      var rad = Math.min(w / 2, 12 + 13 * Math.abs(cl));
      E.rect.setAttribute('rx', f(rad)); E.rect.setAttribute('ry', f(rad));
      var co = proj(side * PI / 2, EAR_PHI, 120 / R, true);
      E.ring.setAttribute('cx', f(co[0])); E.ring.setAttribute('cy', f(co[1]));
      E.ring.setAttribute('rx', f(17 * Math.max(0.01, Math.abs(cl))));
      E.ring.setAttribute('opacity', cl > 0.08 ? (0.6 * Math.min(1, cl * 1.4)).toFixed(2) : '0');
      var layer = c[3] >= 0 ? 1 : 0;
      if (layer !== E.layer) { (layer ? p.earsFront : p.earsBack).appendChild(E.g); E.layer = layer; }
    }

    /* ================= 3D: body ================= */
    var letters = ['l0', 'l1', 'l2'];
    for (i2 = 0; i2 < 3; i2++) {
      var ang = (i2 - 1) * 0.5 + yawBody, ca = Math.cos(ang), hw = bodyHW(384);
      var t = p[letters[i2]];
      if (ca > 0.1) {
        t.style.display = '';
        t.setAttribute('transform', 'translate(' + f(200 + hw * Math.sin(ang)) + ' 384) scale(' + ca.toFixed(3) + ' 1)');
      } else t.style.display = 'none';
    }
    var pa = PI + yawBody, cpa = Math.cos(pa);
    if (cpa > 0.05) {
      p.port.style.display = ''; p.grill.style.display = '';
      p.port.setAttribute('cx', f(200 + bodyHW(372) * Math.sin(pa))); p.port.setAttribute('cy', 372);
      p.port.setAttribute('rx', f(9 * cpa)); p.port.setAttribute('ry', 9);
      var gd = '';
      for (var gl = 0; gl < 3; gl++) {
        var gyv = 396 + gl * 9, hwg = bodyHW(gyv);
        gd += 'M' + f(200 + hwg * Math.sin(pa - 0.42)) + ' ' + gyv + 'L' + f(200 + hwg * Math.sin(pa + 0.42)) + ' ' + gyv;
      }
      p.grill.setAttribute('d', gd);
    } else { p.port.style.display = 'none'; p.grill.style.display = 'none'; }

    var joy = on.bounce || s.phase > 0;
    if (joy !== s.joy) { s.joy = joy; this.el.classList.toggle('isJoy', joy); }
  };

  Pcx.MacFab = MacFab;

  /* mount by itself once the page is ready (skip with window.MAC_FAB_MANUAL = true) */
  function auto() { if (!global.MAC_FAB_MANUAL && !Pcx.mac && !document.querySelector('.macFab')) Pcx.mac = new MacFab(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})(window);
