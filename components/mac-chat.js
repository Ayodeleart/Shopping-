/* Pcx.MacChat: the chat panel MAC opens.
 *
 * A bottom sheet (a side card on wider screens) that talks to the store's existing shopping-assistant API —
 * /api/assistant and /api/assistant-ticket, both already wired to Groq server-side. This component only renders
 * what the server sends back (text, product cards, comparisons, order lookups, add-to-cart / sign-in prompts,
 * and the support-ticket confirm step) — it does not talk to any AI provider itself and carries no key.
 *
 * It mounts itself once the page is ready. To wire it to your store, set `window.MAC_CHAT_MANUAL = true` first:
 *
 *   const chat = new Pcx.MacChat({
 *     mac: Pcx.mac,                                 // the MacFab to bounce while thinking, and to hide while open
 *     endpoint: '/api/assistant', ticketEndpoint: '/api/assistant-ticket',
 *     getSession: () => buyerSession,                // Supabase session or null — adds the auth header for order lookups
 *     getStoreName: () => storeName, fmt, currency,
 *     onNavigate: fn => { chat.close(); fn(); },     // close the sheet, then run the action
 *     openProduct: id => ..., openOrder: id => ..., openSignIn: () => ..., addToCart: (id, qty) => ...
 *   });
 *
 * Methods: open()  close()  toggle()  reset()  ask(text)
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  var SESSION_KEY = 'mac_chat_v1', LANG_KEY = 'ai_lang_pref';    // ai_lang_pref: kept from the old assistant so a returning shopper's language choice still sticks
  var LANGS = [['en', 'English'], ['pcm', 'Nigerian Pidgin'], ['yo', 'Yoruba'], ['ig', 'Igbo'], ['ha', 'Hausa']];
  var GREET = {
    en: ['Hi, I\u2019m MAC', 'Ask me about any product, compare options, or get help with an order.'],
    pcm: ['How far! Na me be MAC', 'Ask me about any product, I go help you find am. I fit help with your order too.'],
    yo: ['Bawo! MAC ni mi', 'B\u00e9\u00e8r\u00e8 l\u1ecdw\u1ecd mi n\u00edpa \u1ecdj\u00e0 kank\u00e0n, t\u00e0b\u00ed n\u00edpa \u00ecb\u00e9\u00e8r\u00e8 r\u1eb9.'],
    ig: ['Nn\u1ecd\u1ecd! Ab\u1ee5 m MAC', 'J\u1ee5\u1ecd m maka ngwaah\u1ecba \u1ecd b\u1ee5la ma \u1ecd b\u1ee5 maka ihe \u1ecb nwere.'],
    ha: ['Sannu! Ni ne MAC', 'Tambaye ni game da kowane kaya ko taimako da oda.']
  };
  var CHIPS = function (cur) {
    return ['Find me something under ' + cur + '50,000', 'Show me new products', 'Help me choose a gift', 'Compare two products', 'I need help with an order'];
  };
  var AVAIL = { in_stock: 'In stock', low_stock: 'Only a few left', out_of_stock: 'Out of stock' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* everything is escaped first, then only **bold**, "- " bullets and blank-line paragraphs are re-added — no raw HTML from the model ever reaches the page */
  function renderText(text) {
    var lines = esc(text).split(/\r?\n/), html = '', list = false;
    lines.forEach(function (ln) {
      var m = /^\s*(?:[-*\u2022])\s+(.*)$/.exec(ln), body = function (t) { return t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); };
      if (m) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + body(m[1]) + '</li>'; }
      else { if (list) { html += '</ul>'; list = false; } if (ln.trim()) html += '<p>' + body(ln) + '</p>'; }
    });
    return html + (list ? '</ul>' : '');
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    [].concat(kids == null ? [] : kids).forEach(function (c) { if (c !== '' && c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var store = {
    get: function (s, k) { try { return JSON.parse(s.getItem(k)); } catch (e) { return null; } },
    set: function (s, k, v) { try { s.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode / full */ } }
  };
  var reduced = function () { return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; };

  var ICON_SEND = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  var ICON_NEW = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  var ICON_X = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  /* MAC's little face in the header. Every 6 s it looks left, looks right, then nods and puts its sunglasses on;
     a quick shake takes them off again. (Animated by mac-chat.css; tap it to replay the routine.) */
  var AVATAR = '<svg class="play" viewBox="0 0 40 40" aria-hidden="true"><circle class="mcInk" cx="20" cy="20" r="20"/>' +
    '<g class="mcFace"><rect class="mcPaper" x="8" y="14" width="24" height="13" rx="6.5"/>' +
    '<circle class="mcInk" cx="15" cy="20.5" r="3"/><circle class="mcInk" cx="25" cy="20.5" r="3"/></g>' +
    '<g class="mcGlasses"><rect class="mcInk" x="6.5" y="16" width="3" height="2" rx="1"/><rect class="mcInk" x="30.5" y="16" width="3" height="2" rx="1"/>' +
    '<rect class="mcInk" x="18.5" y="16" width="3" height="2.4"/>' +
    '<path class="mcInk" d="M8.6 15.4h10.4v5.2c0 3.2-2.2 5.2-5 5.2h-.6c-3 0-4.8-2-4.8-5.2z"/><path class="mcInk" d="M31.4 15.4H21v5.2c0 3.2 2.2 5.2 5 5.2h.6c3 0 4.8-2 4.8-5.2z"/>' +
    '<path class="mcGlint" d="M13.2 17.6l-2.2 5M16.8 17.6l-1 2.2M26.8 17.6l-2.2 5M30.4 17.6l-1 2.2"/></g></svg>';

  function MacChat(opts) {
    var o = this.o = {
      endpoint: '/api/assistant', ticketEndpoint: '/api/assistant-ticket',
      getSession: function () { return null; }, getStoreName: function () { return 'the store'; },
      fmt: function (n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }, currency: '\u20A6',
      onNavigate: function (fn) { fn(); },
      openProduct: null, openOrder: null, openSignIn: null, addToCart: null,
      mac: null, bindTap: true, maxLen: 1000, parent: document.body
    };
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];

    var saved = store.get(sessionStorage, SESSION_KEY) || {};
    this.msgs = Array.isArray(saved.msgs) ? saved.msgs : [];
    this.state = saved.state || {};
    this.lang = saved.lang || store.get(localStorage, LANG_KEY) || 'en';
    this.locked = !!saved.locked || !!store.get(localStorage, LANG_KEY);
    this.busy = false; this.isOpen = false;

    this._build();
    this._bind();
  }
  var P = MacChat.prototype;

  P._mac = function () { return this.o.mac || Pcx.mac || null; };
  P._save = function () { store.set(sessionStorage, SESSION_KEY, { msgs: this.msgs.slice(-40), state: this.state, lang: this.lang, locked: this.locked }); };

  /* ---------- build / bind ---------- */
  P._build = function () {
    var self = this;
    var root = this.root = el('div', { class: 'macChat', hidden: '' });
    root.appendChild(el('div', { class: 'macChat-scrim', 'data-act': 'close' }));

    var sel = this.sel = el('select', { class: 'macChat-lang', 'aria-label': 'Language', onchange: function () { self.lang = sel.value; self.locked = true; store.set(localStorage, LANG_KEY, self.lang); self._save(); self._renderAll(); } },
      LANGS.map(function (l) { return el('option', { value: l[0] }, [l[1]]); }));
    this.log = el('div', { class: 'macChat-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    this.input = el('textarea', { class: 'macChat-input', rows: '1', maxlength: String(this.o.maxLen), placeholder: 'Ask MAC anything', 'aria-label': 'Message to MAC', enterkeyhint: 'send' });
    this.sendBtn = el('button', { class: 'macChat-send', type: 'submit', 'aria-label': 'Send', html: ICON_SEND, disabled: '' });
    this.form = el('form', { class: 'macChat-form', autocomplete: 'off' }, [this.input, this.sendBtn]);

    this.panel = el('section', { class: 'macChat-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Chat with MAC' }, [
      el('header', { class: 'macChat-head' }, [
        el('span', { class: 'macChat-avatar', role: 'button', tabindex: '0', 'aria-label': 'Replay MAC\u2019s routine', html: AVATAR }),
        el('span', { class: 'macChat-title' }, [el('b', {}, [this.o.getStoreName() + ' \u00b7 MAC']), el('small', {}, ['Shopping helper'])]),
        sel,
        el('button', { class: 'macChat-ib', type: 'button', 'data-act': 'new', 'aria-label': 'Start a new chat', html: ICON_NEW }),
        el('button', { class: 'macChat-ib', type: 'button', 'data-act': 'close', 'aria-label': 'Close chat', html: ICON_X })
      ]),
      this.log, this.form,
      el('p', { class: 'macChat-note' }, ['MAC is an AI helper and can make mistakes. Check details on the product page.'])
    ]);
    root.appendChild(this.panel);
    this.o.parent.appendChild(root);
  };

  P._bind = function () {
    var self = this;

    this.root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (t) { var act = t.getAttribute('data-act'); if (act === 'close') self.close(); else if (act === 'new') self._resetTap(); return; }
      if (e.target.closest('.macChat-avatar')) { self._replayAvatar(); return; }
      var chip = e.target.closest('.macChat-chip');
      if (chip) { self.ask(chip.textContent); return; }
      var retry = e.target.closest('.macChat-retry');
      if (retry) { self._retry(); }
    });
    this.root.querySelector('.macChat-avatar').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self._replayAvatar(); } });

    this.form.addEventListener('submit', function (e) { e.preventDefault(); self.ask(self.input.value); });
    this.input.addEventListener('input', function () {
      self.input.style.height = 'auto'; self.input.style.height = Math.min(self.input.scrollHeight, 120) + 'px';
      self.sendBtn.disabled = self.busy || !self.input.value.trim();
    });
    this.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); self.form.requestSubmit ? self.form.requestSubmit() : self.ask(self.input.value); }
    });

    this.root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); self.close(); return; }
      if (e.key === 'Tab') {
        var f = self.panel.querySelectorAll('button:not([disabled]), select, textarea, [tabindex]');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    if (this.o.bindTap) { this._onTap = function (e) { e.preventDefault(); self.open(); }; global.addEventListener('mac:tap', this._onTap); }

    var vv = global.visualViewport;
    this._onVV = function () {
      if (!self.isOpen) return;
      if (global.innerWidth >= 720 || !vv) { self.panel.style.bottom = ''; self.panel.style.maxHeight = ''; return; }
      self.panel.style.bottom = Math.max(0, global.innerHeight - vv.height - vv.offsetTop) + 'px';
      self.panel.style.maxHeight = Math.round(vv.height * 0.94) + 'px';
    };
    if (vv) { vv.addEventListener('resize', this._onVV); vv.addEventListener('scroll', this._onVV); }
    global.addEventListener('resize', this._onVV);
  };

  P._replayAvatar = function () { var sv = this.root.querySelector('.macChat-avatar svg'); sv.classList.remove('play'); void sv.getBoundingClientRect(); sv.classList.add('play'); };

  /* ---------- open / close ---------- */
  P.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;
    this._returnFocus = document.activeElement;
    var mac = this._mac();
    this.root.classList.toggle('isLeft', !!(mac && mac.side === 'left'));
    this.root.classList.toggle('isRight', !(mac && mac.side === 'left'));
    this.sel.value = this.lang;
    this._renderAll();
    this.root.hidden = false;
    this._locked = global.innerWidth < 720;
    if (this._locked) { this._prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    var self = this;
    requestAnimationFrame(function () { self.root.classList.add('on'); self._onVV(); self.input.focus({ preventScroll: true }); });
  };

  P.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    var self = this;
    this.root.classList.remove('on');
    if (this._locked) document.body.style.overflow = this._prevOverflow || '';
    setTimeout(function () { if (!self.isOpen) self.root.hidden = true; }, reduced() ? 0 : 260);
    var mac = this._mac();
    if (mac && this._returnFocus === mac.el) mac.el.focus({ preventScroll: true });
  };
  P.toggle = function () { this.isOpen ? this.close() : this.open(); };

  P._resetTap = function () {
    var self = this;
    if (!this.msgs.length) return;
    var btn = this.root.querySelector('[data-act="new"]');
    if (!this._confirmReset) {
      this._confirmReset = true; btn.setAttribute('aria-label', 'Tap again to clear this conversation'); btn.classList.add('warn');
      setTimeout(function () { self._confirmReset = false; btn.setAttribute('aria-label', 'Start a new chat'); btn.classList.remove('warn'); }, 3500);
      return;
    }
    this._confirmReset = false; btn.classList.remove('warn');
    this.reset();
  };
  P.reset = function () {
    this.msgs = []; this.state = { language: this.lang }; this.busy = false;
    this._save(); this._renderAll();
    this.input.value = ''; this.input.style.height = 'auto'; this.sendBtn.disabled = true;
    this.input.focus({ preventScroll: true });
  };

  /* ---------- rendering ---------- */
  P._toBottom = function (instant) {
    var l = this.log;
    if (instant || reduced()) l.scrollTop = l.scrollHeight; else l.scrollTo({ top: l.scrollHeight, behavior: 'smooth' });
  };
  P._sync = function () { this.sendBtn.disabled = this.busy || !this.input.value.trim(); this.log.setAttribute('aria-busy', this.busy ? 'true' : 'false'); };

  P._renderAll = function () {
    var self = this, box = this.log;
    box.textContent = '';
    if (!this.msgs.length) {
      var g = GREET[this.lang] || GREET.en;
      box.appendChild(el('div', { class: 'macChat-empty' }, [
        el('h2', {}, [g[0]]), el('p', {}, [g[1]]),
        el('div', { class: 'macChat-chips' }, CHIPS(this.o.currency).map(function (t) { return el('button', { class: 'macChat-chip', type: 'button' }, [t]); }))
      ]));
    } else {
      this.msgs.forEach(function (m, i) { box.appendChild(self._msgNode(m, i)); });
      if (this.busy) box.appendChild(el('div', { class: 'macChat-msg bot macChat-typing', role: 'status', 'aria-label': 'MAC is typing' }, [el('span'), el('span'), el('span')]));
    }
    this._sync(); this._toBottom(true);
  };

  P._msgNode = function (m, idx) {
    var self = this, wrap = el('div', { class: 'macChat-turn ' + (m.role === 'user' ? 'me' : 'bot') });
    if (m.content) wrap.appendChild(el('div', { class: 'macChat-msg ' + (m.role === 'user' ? 'me' : 'bot') + (m.error ? ' err' : ''), html: m.role === 'user' ? '<p>' + esc(m.content) + '</p>' : renderText(m.content) }));
    if (m.error) wrap.appendChild(el('button', { class: 'macChat-retry', type: 'button' }, ['Try again']));
    var kids = [];
    (m.cards || []).forEach(function (c) { var n = self._card(c); if (n) kids.push(n); });
    (m.actions || []).forEach(function (a, ai) { var n = self._action(m, a, ai); if (n) kids.push(n); });
    if (m.ticket) kids.push(self._ticket(m, idx));
    if (kids.length) wrap.appendChild(el('div', { class: 'macChat-extras' }, kids));
    return wrap;
  };

  P._card = function (c) {
    var self = this;
    if (c.kind === 'product') {
      var img = c.image ? el('img', { src: c.image, alt: c.name, loading: 'lazy' }) : el('div', { class: 'mcPh', 'aria-hidden': 'true' }, [(c.name || '?').charAt(0).toUpperCase()]);
      var btns = [el('button', { class: 'mcBtn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(c.id); }); } }, ['View product'])];
      if (c.availability !== 'out_of_stock' && this.o.addToCart) {
        var add = el('button', { class: 'mcBtn', type: 'button', onclick: function () { self.o.addToCart(c.id, 1); add.textContent = 'Added'; add.disabled = true; setTimeout(function () { add.textContent = 'Add to cart'; add.disabled = false; }, 2200); } }, ['Add to cart']);
        btns.push(add);
      }
      var price = el('div', { class: 'mcPp' }, [this.o.fmt(c.price)]);
      if (c.originalPrice && c.originalPrice > c.price) price.appendChild(el('s', {}, [this.o.fmt(c.originalPrice)]));
      return el('div', { class: 'mcPc' }, [img, el('div', { class: 'mcPi' }, [el('div', { class: 'mcPn' }, [c.name]), price, el('div', { class: 'mcPa ' + c.availability }, [AVAIL[c.availability] || '']), c.reason ? el('div', { class: 'mcPr' }, [c.reason]) : '', el('div', { class: 'mcBtns' }, btns)])]);
    }
    if (c.kind === 'compare') {
      var head = el('tr', {}, [el('th', {}, [''])].concat(c.products.map(function (p) {
        return el('th', {}, [el('div', {}, [p.name]), el('div', { class: 'mcPp' }, [self.o.fmt(p.price)]), el('div', { class: 'mcPa ' + p.availability }, [AVAIL[p.availability] || '']),
          el('button', { class: 'mcBtn', type: 'button', style: 'margin-top:5px', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(p.id); }); } }, ['View'])]);
      })));
      var body = (c.rows || []).map(function (r) { return el('tr', {}, [el('td', {}, [r.label])].concat(r.values.map(function (v) { return el('td', {}, [v || '\u2014']); }))); });
      return el('div', { class: 'mcCmp', role: 'region', 'aria-label': 'Product comparison', tabindex: '0' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])]);
    }
    if (c.kind === 'orders') {
      return el('div', { class: 'macChat-extras' }, (c.orders || []).map(function (o) {
        return el('button', { class: 'mcOrd', type: 'button', onclick: function () { if (o.id) self.o.onNavigate(function () { self.o.openOrder(o.id); }); } },
          [el('span', {}, [el('b', {}, ['#' + o.orderNumber]), el('small', {}, [(o.placedAt ? new Date(o.placedAt).toLocaleDateString() : '') + ' \u00b7 ' + self.o.fmt(o.total)])]), el('span', { class: 'mcPa in_stock' }, [String(o.delivery || '').replace(/_/g, ' ')])]);
      }));
    }
    return null;
  };

  P._action = function (m, a, ai) {
    var self = this, key = 'a' + ai;
    if (a.type === 'open_product') return el('button', { class: 'mcBtn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(a.id); }); } }, ['Open ' + a.name]);
    if (a.type === 'sign_in') return el('button', { class: 'mcBtn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openSignIn(); }); } }, ['Sign in']);
    if (a.type === 'add_to_cart') {
      var done = m.done && m.done[key];
      if (done) return el('div', { class: 'mcBox' }, [done === 'added' ? 'Added to your cart.' : 'Okay, not added.']);
      return el('div', { class: 'mcBox' }, [el('h4', {}, ['Add to cart?']), el('div', {}, [a.quantity + ' \u00d7 ' + a.name + ' \u2014 ' + this.o.fmt(a.price * a.quantity)]),
        el('div', { class: 'mcBtns' }, [
          el('button', { class: 'mcBtn pri', type: 'button', onclick: function () { self.o.addToCart(a.id, a.quantity); self._mark(m, key, 'added'); } }, ['Add to cart']),
          el('button', { class: 'mcBtn', type: 'button', onclick: function () { self._mark(m, key, 'no'); } }, ['No thanks'])])]);
    }
    return null;
  };
  P._mark = function (m, key, v) { m.done = m.done || {}; m.done[key] = v; this._save(); this._renderAll(); };

  /* support ticket: nothing is sent until the shopper taps Submit; the server-signed token means it can't be edited here */
  P._ticket = function (m) {
    var self = this, t = m.ticket, p = t.preview || {};
    var rows = [['Issue', String(p.category || '').replace(/_/g, ' ')], ['Order', p.orderNumber], ['Product', p.productName], ['Summary', p.summary], ['Name', p.name], ['Contact', [p.email, p.phone].filter(Boolean).join(' / ')]].filter(function (r) { return r[1]; });
    var dl = el('dl', {}); rows.forEach(function (r) { dl.appendChild(el('dt', {}, [r[0]])); dl.appendChild(el('dd', {}, [r[1]])); });
    if (t.state === 'sent') return el('div', { class: 'mcBox' }, [el('h4', {}, ['Sent to support']), dl, el('div', {}, ['Reference #' + t.id])]);
    if (t.state === 'cancelled') return el('div', { class: 'mcBox' }, ['Nothing was sent.']);
    var send = el('button', { class: 'mcBtn pri', type: 'button', disabled: t.state === 'sending' ? '' : null, onclick: function () { self._submitTicket(m); } }, [t.state === 'sending' ? 'Sending\u2026' : 'Submit to support']);
    var cancel = el('button', { class: 'mcBtn', type: 'button', disabled: t.state === 'sending' ? '' : null, onclick: function () {
      t.state = 'cancelled'; self.msgs.push({ role: 'assistant', content: 'Okay, I have not sent anything to support.' }); self._save(); self._renderAll();
    } }, ['Cancel']);
    return el('div', { class: 'mcBox' }, [el('h4', {}, ['Send this to support?']), dl, t.error ? el('div', { style: 'color:var(--red);margin-top:6px' }, [t.error]) : '', el('div', { class: 'mcBtns' }, [send, cancel])]);
  };
  P._submitTicket = function (m) {
    var self = this, t = m.ticket;
    if (t.state === 'sending') return;
    t.state = 'sending'; t.error = ''; this._renderAll();
    var s = this.o.getSession(), headers = { 'Content-Type': 'application/json' };
    if (s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;
    fetch(this.o.ticketEndpoint, { method: 'POST', headers: headers, body: JSON.stringify({ token: t.token }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok) { t.state = 'sent'; t.id = x.j.ticketId; self.msgs.push({ role: 'assistant', content: 'Done. Your request has been sent to support. Your reference is #' + x.j.ticketId + '.' }); }
        else { t.state = 'error'; t.error = x.j.error || 'We could not send it. Please try again.'; }
        self._save(); self._renderAll();
      }).catch(function () { t.state = 'error'; t.error = 'No connection. Please try again.'; self._save(); self._renderAll(); });
  };

  /* ---------- sending ---------- */
  P.ask = function (text) {
    text = String(text || '').trim().slice(0, this.o.maxLen);
    if (!text || this.busy) return;
    this.msgs.push({ role: 'user', content: text });
    this._save(); this._renderAll();
    this.input.value = ''; this.input.style.height = 'auto';
    this._ask();
  };

  P._ask = function () {
    var self = this, mac = this._mac();
    this.busy = true; this._renderAll();
    if (mac) mac.set('bounce', true);
    var s = this.o.getSession(), headers = { 'Content-Type': 'application/json' };
    if (s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;
    var history = this.msgs.filter(function (m) { return m.content && !m.error; }).slice(-14).map(function (m) { return { role: m.role, content: m.content.slice(0, 1500) }; });
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 40000);
    fetch(this.o.endpoint, { method: 'POST', headers: headers, signal: ctl ? ctl.signal : undefined, body: JSON.stringify({ messages: history, language: this.lang, languageLocked: this.locked, state: this.state, context: this.o.getContext ? this.o.getContext() : {} }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw { user: x.j.error || 'Something went wrong. Please try again.' };
        var j = x.j;
        self.state = j.state || self.state;
        if (j.language && !self.locked && j.language !== self.lang) { self.lang = j.language; self.sel.value = j.language; }
        self.msgs.push({ role: 'assistant', content: j.reply, cards: j.cards || [], actions: j.actions || [], ticket: j.ticket ? { token: j.ticket.token, preview: j.ticket.preview, state: 'pending' } : null });
      })
      .catch(function (e) {
        var text = e && e.user ? e.user : (e && e.name === 'AbortError' ? 'That took too long. Please try again.' : 'I could not reach MAC. Check your connection and try again.');
        self.msgs.push({ role: 'assistant', content: text, error: true });
      })
      .then(function () {
        clearTimeout(timer); self.busy = false; self._save();
        if (mac) mac.set('bounce', false);
        if (self.isOpen) { self._renderAll(); if (global.innerWidth >= 720) self.input.focus({ preventScroll: true }); }
      });
  };

  P._retry = function () {
    if (this.busy) return;
    var last = this.msgs[this.msgs.length - 1];
    if (!last || !last.error) return;
    this.msgs.pop(); this._save(); this._renderAll(); this._ask();
  };

  P.destroy = function () {
    if (this._onTap) global.removeEventListener('mac:tap', this._onTap);
    global.removeEventListener('resize', this._onVV);
    if (this.isOpen && this._locked) document.body.style.overflow = this._prevOverflow || '';
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  Pcx.MacChat = MacChat;

  function auto() { if (!global.MAC_CHAT_MANUAL && !Pcx.macChat) Pcx.macChat = new MacChat(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})(window);
