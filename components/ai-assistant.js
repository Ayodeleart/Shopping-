/* Pcx.Assistant: floating assistant button (+ teaser) and the full-page shopping assistant.
 *
 *   const ai = new Pcx.Assistant({
 *     endpoint: '/api/assistant', ticketEndpoint: '/api/assistant-ticket',
 *     getSession: () => buyerSession,            // Supabase session or null (adds the auth header for order lookups)
 *     getStoreName: () => storeName, fmt,        // price formatter used by the store
 *     onBack: () => history.back(),              // page close button (the host owns the URL hash, like the other pages)
 *     onNavigate: fn => fn(),                    // host closes the assistant first, then runs fn (open product / order / sign in)
 *     openProduct: id => ..., openOrder: id => ..., openSignIn: () => ..., addToCart: (id, qty) => ...
 *   });
 *   ai.mountFab();   ai.open();   ai.close();
 *
 * The page is built on first open, so the button costs almost nothing on page load. All model text is escaped before it is
 * rendered; product cards come from the server (real database values), never from model text.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  var SESSION_KEY = 'ai_chat_v1', LANG_KEY = 'ai_lang_pref', TEASER_OFF = 'ai_teaser_off', USED_KEY = 'ai_used_at';
  var LANGS = [['en', 'English'], ['pcm', 'Nigerian Pidgin'], ['yo', 'Yoruba'], ['ig', 'Igbo'], ['ha', 'Hausa']];
  var SPARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 2l2.2 6.3L19.5 10.5 13.2 12.7 11 19l-2.2-6.3L2.5 10.5l6.3-2.2L11 2z"/><path d="M19 14l1 2.9 2.9 1-2.9 1-1 2.9-1-2.9-2.9-1 2.9-1 1-2.9z"/></svg>';
  var ICON_BACK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
  var ICON_RESET = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 9 9 9"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4l17.4-7.6a1 1 0 0 0 0-1.8L3.4 3.6a.8.8 0 0 0-1.1.9L3.6 10l9 2-9 2-1.3 5.5a.8.8 0 0 0 1.1.9z"/></svg>';

  var TEASERS = {
    en: ['How can I help you?', 'What are you looking for?', 'Need help finding a product?', 'Ask me about any product.', 'Need help with your order?', 'Compare products with me.', 'Wetin you wan buy?', 'I fit help you find am.'],
    pcm: ['Wetin you wan buy?', 'I fit help you find am.', 'Abeg, ask me about any product.', 'You need help with your order?'],
    yo: ['Bawo ni mo ṣe lè ràn ọ́ lọ́wọ́?', 'Kí ni o fẹ́ rà?', 'Béèrè lọ́wọ́ mi nípa ọjà kankan.'],
    ig: ['Kedu ka m ga-esi nyere gị aka?', 'Gịnị ka ị chọrọ ịzụta?', 'Jụọ m maka ngwaahịa ọ bụla.'],
    ha: ['Yaya zan taimaka maka?', 'Me kuke nema?', 'Tambaye ni game da kowane kaya.']
  };
  var GREET = {
    en: ['Hi, I am your shopping assistant', 'Ask me about any product, compare options, or get help with an order.'],
    pcm: ['How far! I be your shopping assistant', 'Ask me about any product, I go help you find am. I fit help with your order too.'],
    yo: ['Bawo! Èmi ni olùrànlọ́wọ́ rẹ fún rírà ọjà', 'Béèrè lọ́wọ́ mi nípa ọjà kankan, tàbí nípa ìbéèrè rẹ.'],
    ig: ['Nnọọ! Abụ m onye enyemaka gị n’ịzụ ahịa', 'Jụọ m maka ngwaahịa ọ bụla ma ọ bụ maka i̇he i nwere.'],
    ha: ['Sannu! Ni mataimakinka ne wajen siyayya', 'Tambaye ni game da kowane kaya ko taimako da oda.']
  };
  var CHIPS = function (cur) {
    return ['Find me something under ' + cur + '50,000', 'Show me new products', 'Help me choose a gift', 'Compare two products', 'I need help with an order', 'Wetin you wan buy?', 'Mo n wa ọja kan'];
  };

  var reduced = function () { return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    [].concat(kids == null ? [] : kids).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var store = {
    get: function (s, k) { try { return JSON.parse(s.getItem(k)); } catch (e) { return null; } },
    set: function (s, k, v) { try { s.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode / full */ } }
  };

  /* Tiny, safe formatter: everything is escaped first, then only **bold**, "- " bullets and paragraphs are re-added. No links, no HTML. */
  function renderText(text) {
    var lines = esc(text).split(/\n/), html = '', list = false;
    lines.forEach(function (ln) {
      var m = /^\s*(?:[-*\u2022])\s+(.*)$/.exec(ln), body = function (t) { return t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); };
      if (m) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + body(m[1]) + '</li>'; }
      else { if (list) { html += '</ul>'; list = false; } if (ln.trim()) html += '<p>' + body(ln) + '</p>'; }
    });
    return html + (list ? '</ul>' : '');
  }

  function Assistant(opts) {
    this.o = Object.assign({ endpoint: '/api/assistant', ticketEndpoint: '/api/assistant-ticket', getSession: function () { return null; }, getStoreName: function () { return 'Store'; },
      fmt: function (n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }, currency: '\u20A6', onBack: function () {}, onNavigate: function (f) { f(); } }, opts || {});
    var saved = store.get(sessionStorage, SESSION_KEY) || {};
    this.msgs = Array.isArray(saved.msgs) ? saved.msgs : [];
    this.state = saved.state || {};
    this.lang = saved.lang || store.get(localStorage, LANG_KEY) || 'en';
    this.locked = !!saved.locked || !!store.get(localStorage, LANG_KEY);
    this.busy = false; this.isOpen = false; this.page = null; this.fab = null;
  }
  var P = Assistant.prototype;

  P._save = function () {
    store.set(sessionStorage, SESSION_KEY, { msgs: this.msgs.slice(-40), state: this.state, lang: this.lang, locked: this.locked });
  };

  /* ------------------------------------------------------------ floating button + teaser */
  P.mountFab = function () {
    var self = this;
    if (this.fab) return;
    this.fab = el('button', { class: 'ai-fab', type: 'button', 'aria-label': 'Open shopping assistant', html: SPARK, onclick: function () { self.o.onOpen ? self.o.onOpen() : self.open(); } });
    this.teaser = el('div', { class: 'ai-teaser', hidden: '' }, [
      el('button', { class: 'ai-tt', type: 'button', 'aria-label': 'Open shopping assistant', onclick: function () { self.o.onOpen ? self.o.onOpen() : self.open(); } }, [el('span', { 'aria-hidden': 'true' })]),
      el('button', { class: 'ai-tx', type: 'button', 'aria-label': 'Dismiss assistant suggestions', onclick: function (e) { e.stopPropagation(); self._dismissTeaser(); } }, ['\u00d7'])
    ]);
    if (this.msgs.length) this.fab.appendChild(el('span', { class: 'ai-fab-dot', 'aria-hidden': 'true' }));
    document.body.appendChild(this.teaser); document.body.appendChild(this.fab);

    /* hide while any full-screen page/drawer is open (they all lock body scroll or use the URL hash) */
    var sync = function () { var covered = document.body.style.overflow === 'hidden' || !!location.hash || self.isOpen; self.fab.hidden = covered; if (covered) self._hideTeaser(); };
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['style'] });
    global.addEventListener('hashchange', sync); sync();

    /* slide away on scroll down, back on scroll up: never sits on top of the product grid while browsing */
    var lastY = global.scrollY, ticking = false;
    global.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      global.requestAnimationFrame(function () {
        var y = global.scrollY, d = y - lastY;
        if (Math.abs(d) > 6) { self.fab.classList.toggle('away', d > 0 && y > 120); if (d > 0 && y > 120) self._hideTeaser(); lastY = y; }
        ticking = false;
      });
    }, { passive: true });

    if (!reduced()) setTimeout(function () { self.fab.classList.add('pulse'); }, 1800);
    this._startTeaser();
  };

  P._teaserOk = function () {
    var off = store.get(localStorage, TEASER_OFF), used = store.get(localStorage, USED_KEY);
    if (off && Date.now() - off < 14 * 86400e3) return false;         // dismissed: stay quiet for two weeks
    if (used && Date.now() - used < 3 * 86400e3) return false;        // they already know where it is
    return true;
  };
  P._startTeaser = function () {
    var self = this, shown = store.get(sessionStorage, 'ai_teaser_n') || 0, i = 0;
    if (!this._teaserOk()) return;
    var cycle = function () {
      if (!self._teaserOk() || shown >= 4 || self.isOpen) return;
      if (!self.fab.hidden && !self.fab.classList.contains('away') && !document.hidden) {
        var pool = TEASERS[self.locked ? self.lang : 'en'] || TEASERS.en;
        self.teaser.querySelector('span').textContent = pool[i++ % pool.length];
        self.teaser.hidden = false;
        global.requestAnimationFrame(function () { self.teaser.classList.add('on'); });
        shown++; store.set(sessionStorage, 'ai_teaser_n', shown);
        self._teaserTimer = setTimeout(function () { self._hideTeaser(); }, 5000);
      }
      self._cycleTimer = setTimeout(cycle, 16000);
    };
    this._cycleTimer = setTimeout(cycle, 7000);
  };
  P._hideTeaser = function () {
    var t = this.teaser; if (!t || t.hidden) return;
    clearTimeout(this._teaserTimer); t.classList.remove('on');
    setTimeout(function () { if (!t.classList.contains('on')) t.hidden = true; }, reduced() ? 0 : 260);
  };
  P._dismissTeaser = function () {
    store.set(localStorage, TEASER_OFF, Date.now());
    clearTimeout(this._cycleTimer); this._hideTeaser();
  };

  /* ------------------------------------------------------------ page */
  P._build = function () {
    var self = this;
    var sel = el('select', { class: 'ai-lang', 'aria-label': 'Language', onchange: function () { self.lang = sel.value; self.locked = true; store.set(localStorage, LANG_KEY, self.lang); self._save(); self._render(); } },
      LANGS.map(function (l) { return el('option', { value: l[0] }, [l[1]]); }));
    this.sel = sel;
    this.resetBtn = el('button', { class: 'ai-hbtn', type: 'button', 'aria-label': 'Start a new conversation', html: ICON_RESET, onclick: function () { self._reset(); } });
    this.msgsEl = el('div', { class: 'ai-msgs', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    this.input = el('textarea', { class: 'ai-input', rows: '1', placeholder: 'Ask about any product\u2026', 'aria-label': 'Message', maxlength: '1000', enterkeyhint: 'send',
      oninput: function () { self._grow(); self._sync(); },
      onkeydown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); self._submit(); } } });
    this.sendBtn = el('button', { class: 'ai-send', type: 'submit', 'aria-label': 'Send message', html: ICON_SEND, disabled: '' });
    var form = el('form', { class: 'ai-form', onsubmit: function (e) { e.preventDefault(); self._submit(); } }, [this.input, this.sendBtn]);
    this.titleEl = el('b', {}, [this.o.getStoreName() + ' Assistant']);
    this.page = el('div', { class: 'ai-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Shopping assistant', inert: '' }, [
      el('header', { class: 'ai-hdr' }, [
        el('button', { class: 'ai-hbtn', type: 'button', 'aria-label': 'Close assistant and go back', html: ICON_BACK, onclick: function () { self.o.onBack(); } }),
        el('div', { class: 'ai-htitle' }, [this.titleEl, el('span', {}, ['AI shopping help'])]),
        sel, this.resetBtn
      ]),
      this.msgsEl, form
    ]);
    document.body.appendChild(this.page);
    this.page.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); self.o.onBack(); } });
    this.page.addEventListener('transitionend', function (e) { if (e.propertyName === 'clip-path' && !self.isOpen) self.page.setAttribute('inert', ''); });
    /* iOS: keep the composer above the keyboard */
    var vv = global.visualViewport;
    if (vv) {
      var fit = function () { if (!self.isOpen) return; self.page.style.height = vv.height + 'px'; self.page.style.transform = 'translateY(' + vv.offsetTop + 'px)'; self._toBottom(); };
      vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); this._fit = fit;
    }
  };

  P.open = function () {
    var self = this;
    if (!this.page) this._build();
    if (this.isOpen) return;
    this.isOpen = true;
    this.titleEl.textContent = this.o.getStoreName() + ' Assistant';
    this.sel.value = this.lang;
    this._render(); this._hideTeaser();
    store.set(localStorage, USED_KEY, Date.now());
    if (this.fab) { this.fab.hidden = true; var d = this.fab.querySelector('.ai-fab-dot'); if (d) d.remove(); }
    /* grow from the button: the circle starts at the button's centre */
    var r = this.fab && this.fab.getBoundingClientRect(), pr = this.page.getBoundingClientRect();
    var cx = r && r.width ? r.left + r.width / 2 : global.innerWidth - 41, cy = r && r.height ? r.top + r.height / 2 : global.innerHeight - 45;
    this.page.style.setProperty('--ox', (cx - pr.left) + 'px'); this.page.style.setProperty('--oy', (cy - pr.top) + 'px');
    this._prevFocus = document.activeElement;
    this.page.removeAttribute('inert');
    void this.page.offsetWidth;
    this.page.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (this._fit) this._fit();
    setTimeout(function () { self._toBottom(); if (!self.msgs.length && !global.matchMedia('(pointer:coarse)').matches) self.input.focus(); else self.input.focus({ preventScroll: true }); }, reduced() ? 0 : 320);
  };

  P.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.page.classList.remove('open');
    if (reduced()) this.page.setAttribute('inert', '');
    this.input.blur();
    document.body.style.overflow = '';
    if (this.fab) this.fab.hidden = !!location.hash;
    if (this._prevFocus && this._prevFocus.focus) { try { this._prevFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    if (this.fab && this.msgs.length && !this.fab.querySelector('.ai-fab-dot')) this.fab.appendChild(el('span', { class: 'ai-fab-dot', 'aria-hidden': 'true' }));
  };

  P._reset = function () {
    var self = this;
    if (!this.msgs.length) return;
    if (!this._confirmReset) {
      this._confirmReset = true; this.resetBtn.setAttribute('aria-label', 'Tap again to clear this conversation'); this.resetBtn.style.color = 'var(--red)';
      setTimeout(function () { self._confirmReset = false; self.resetBtn.setAttribute('aria-label', 'Start a new conversation'); self.resetBtn.style.color = ''; }, 3500);
      return;
    }
    this._confirmReset = false; this.resetBtn.style.color = '';
    this.msgs = []; this.state = { language: this.lang }; this._save(); this._render(); this.input.value = ''; this._grow(); this._sync();
  };

  /* ------------------------------------------------------------ rendering */
  P._toBottom = function () { var m = this.msgsEl; if (m) m.scrollTop = m.scrollHeight; };
  P._grow = function () { var i = this.input; i.style.height = 'auto'; i.style.height = Math.min(i.scrollHeight, 120) + 'px'; };
  P._sync = function () { this.sendBtn.disabled = this.busy || !this.input.value.trim(); this.msgsEl.setAttribute('aria-busy', this.busy ? 'true' : 'false'); };

  P._render = function () {
    var self = this, box = this.msgsEl;
    box.textContent = '';
    if (!this.msgs.length) {
      var g = GREET[this.lang] || GREET.en;
      box.appendChild(el('div', { class: 'ai-empty' }, [
        el('div', { class: 'ai-avatar', html: SPARK }), el('h2', {}, [g[0]]), el('p', {}, [g[1]]),
        el('div', { class: 'ai-chips' }, CHIPS(this.o.currency).map(function (t) { return el('button', { class: 'ai-chip', type: 'button', onclick: function () { self._send(t); } }, [t]); })),
        el('p', { class: 'ai-note' }, ['AI answers can be wrong. Prices and stock shown on product cards come from the store.'])
      ]));
    } else {
      this.msgs.forEach(function (m, i) { box.appendChild(self._msgNode(m, i)); });
      if (this.busy) box.appendChild(el('div', { class: 'ai-row bot' }, [el('div', { class: 'ai-bub ai-typing', role: 'status', 'aria-label': 'Assistant is typing' }, [el('i'), el('i'), el('i')])]));
    }
    this._sync(); this._toBottom();
  };

  P._msgNode = function (m, idx) {
    var self = this, row = el('div', { class: 'ai-row ' + (m.role === 'user' ? 'user' : 'bot') });
    if (m.content) row.appendChild(el('div', { class: 'ai-bub' + (m.error ? ' err' : ''), html: m.role === 'user' ? '<p>' + esc(m.content) + '</p>' : renderText(m.content) }));
    if (m.error) row.appendChild(el('button', { class: 'ai-retry', type: 'button', onclick: function () { self.msgs.splice(idx, 1); self._save(); self._render(); self._ask(); } }, ['Try again']));
    var kids = [];
    (m.cards || []).forEach(function (c) { var n = self._card(c); if (n) kids.push(n); });
    (m.actions || []).forEach(function (a, ai) { var n = self._action(m, a, ai); if (n) kids.push(n); });
    if (m.ticket) kids.push(self._ticket(m));
    if (kids.length) row.appendChild(el('div', { class: 'ai-cards' }, kids));
    return row;
  };

  var AVAIL = { in_stock: 'In stock', low_stock: 'Only a few left', out_of_stock: 'Out of stock' };

  P._card = function (c) {
    var self = this;
    if (c.kind === 'product') {
      var img = c.image ? el('img', { src: c.image, alt: c.name, loading: 'lazy' }) : el('div', { class: 'ph', 'aria-hidden': 'true' }, [(c.name || '?').charAt(0).toUpperCase()]);
      var btns = [el('button', { class: 'ai-btn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(c.id); }); } }, ['View product'])];
      if (c.availability !== 'out_of_stock' && this.o.addToCart) {
        var add = el('button', { class: 'ai-btn', type: 'button', onclick: function () { self.o.addToCart(c.id, 1); add.textContent = 'Added'; add.disabled = true; setTimeout(function () { add.textContent = 'Add to cart'; add.disabled = false; }, 2200); } }, ['Add to cart']);
        btns.push(add);
      }
      var price = el('div', { class: 'ai-pp' }, [this.o.fmt(c.price)]);
      if (c.originalPrice && c.originalPrice > c.price) price.appendChild(el('s', {}, [this.o.fmt(c.originalPrice)]));
      return el('div', { class: 'ai-pc' }, [img, el('div', { class: 'ai-pi' }, [el('div', { class: 'ai-pn' }, [c.name]), price, el('div', { class: 'ai-pa ' + c.availability }, [AVAIL[c.availability] || '']), c.reason ? el('div', { class: 'ai-pr' }, [c.reason]) : '', el('div', { class: 'ai-btns' }, btns)])]);
    }
    if (c.kind === 'compare') {
      var head = el('tr', {}, [el('th', {}, [''])].concat(c.products.map(function (p) {
        return el('th', {}, [el('div', {}, [p.name]), el('div', { class: 'ai-pp' }, [self.o.fmt(p.price)]), el('div', { class: 'ai-pa ' + p.availability }, [AVAIL[p.availability] || '']),
          el('button', { class: 'ai-btn', type: 'button', style: 'margin-top:5px', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(p.id); }); } }, ['View'])]);
      })));
      var body = (c.rows || []).map(function (r) { return el('tr', {}, [el('td', {}, [r.label])].concat(r.values.map(function (v) { return el('td', {}, [v || '\u2014']); }))); });
      return el('div', { class: 'ai-cmp', role: 'region', 'aria-label': 'Product comparison', tabindex: '0' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])]);
    }
    if (c.kind === 'orders') {
      return el('div', { class: 'ai-cards' }, (c.orders || []).map(function (o) {
        return el('button', { class: 'ai-ord', type: 'button', onclick: function () { if (o.id) self.o.onNavigate(function () { self.o.openOrder(o.id); }); } },
          [el('span', {}, [el('b', {}, ['#' + o.orderNumber]), el('small', {}, [(o.placedAt ? new Date(o.placedAt).toLocaleDateString() : '') + ' \u00b7 ' + self.o.fmt(o.total)])]), el('span', { class: 'ai-pa in_stock' }, [String(o.delivery || '').replace(/_/g, ' ')])]);
      }));
    }
    return null;
  };

  P._action = function (m, a, ai) {
    var self = this, key = 'a' + ai;
    if (a.type === 'open_product') return el('button', { class: 'ai-btn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(a.id); }); } }, ['Open ' + a.name]);
    if (a.type === 'sign_in') return el('button', { class: 'ai-btn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openSignIn(); }); } }, ['Sign in']);
    if (a.type === 'add_to_cart') {
      var done = m.done && m.done[key];
      if (done) return el('div', { class: 'ai-box' }, [done === 'added' ? 'Added to your cart.' : 'Okay, not added.']);
      return el('div', { class: 'ai-box' }, [el('h4', {}, ['Add to cart?']), el('div', {}, [a.quantity + ' \u00d7 ' + a.name + ' \u2014 ' + this.o.fmt(a.price * a.quantity)]),
        el('div', { class: 'ai-btns' }, [
          el('button', { class: 'ai-btn pri', type: 'button', onclick: function () { self.o.addToCart(a.id, a.quantity); self._mark(m, key, 'added'); } }, ['Add to cart']),
          el('button', { class: 'ai-btn', type: 'button', onclick: function () { self._mark(m, key, 'no'); } }, ['No thanks'])])]);
    }
    return null;
  };
  P._mark = function (m, key, v) { m.done = m.done || {}; m.done[key] = v; this._save(); this._render(); };

  /* Support ticket: nothing is sent until the customer taps Submit. The server signs the summary, so it cannot be edited here. */
  P._ticket = function (m) {
    var self = this, t = m.ticket, p = t.preview || {};
    var rows = [['Issue', String(p.category || '').replace(/_/g, ' ')], ['Order', p.orderNumber], ['Product', p.productName], ['Summary', p.summary], ['Name', p.name], ['Contact', [p.email, p.phone].filter(Boolean).join(' / ')]].filter(function (r) { return r[1]; });
    var dl = el('dl', {}); rows.forEach(function (r) { dl.appendChild(el('dt', {}, [r[0]])); dl.appendChild(el('dd', {}, [r[1]])); });
    if (t.state === 'sent') return el('div', { class: 'ai-box' }, [el('h4', {}, ['Sent to support']), dl, el('div', {}, ['Reference #' + t.id])]);
    if (t.state === 'cancelled') return el('div', { class: 'ai-box' }, ['Nothing was sent.']);
    var send = el('button', { class: 'ai-btn pri', type: 'button', disabled: t.state === 'sending' ? '' : null, onclick: function () { self._submitTicket(m); } }, [t.state === 'sending' ? 'Sending\u2026' : 'Submit to support']);
    var cancel = el('button', { class: 'ai-btn', type: 'button', disabled: t.state === 'sending' ? '' : null, onclick: function () {
      t.state = 'cancelled'; self.msgs.push({ role: 'assistant', content: 'Okay, I have not sent anything to support. Let me know if you would like to try again or need something else.' }); self._save(); self._render();
    } }, ['Cancel']);
    return el('div', { class: 'ai-box' }, [el('h4', {}, ['Send this to support?']), dl, t.error ? el('div', { style: 'color:var(--red);margin-top:6px' }, [t.error]) : '', el('div', { class: 'ai-btns' }, [send, cancel])]);
  };
  P._submitTicket = function (m) {
    var self = this, t = m.ticket;
    if (t.state === 'sending') return;
    t.state = 'sending'; t.error = ''; this._render();
    var s = this.o.getSession(), headers = { 'Content-Type': 'application/json' };
    if (s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;
    fetch(this.o.ticketEndpoint, { method: 'POST', headers: headers, body: JSON.stringify({ token: t.token }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok) { t.state = 'sent'; t.id = x.j.ticketId; self.msgs.push({ role: 'assistant', content: 'Done. Your request has been sent to support. Your reference is #' + x.j.ticketId + '.' }); }
        else { t.state = 'error'; t.error = x.j.error || 'We could not send it. Please try again.'; }
        self._save(); self._render();
      }).catch(function () { t.state = 'error'; t.error = 'No connection. Please try again.'; self._save(); self._render(); });
  };

  /* ------------------------------------------------------------ sending */
  P._submit = function () { var v = this.input.value.trim(); if (!v || this.busy) return; this.input.value = ''; this._grow(); this._send(v); };
  P._send = function (text) {
    if (this.busy) return;                       // one question at a time: rapid taps/Enter never double-send
    this.msgs.push({ role: 'user', content: String(text).slice(0, 1000) });
    this._save(); this._ask();
  };

  P._ask = function () {
    var self = this;
    this.busy = true; this._render();
    var s = this.o.getSession(), headers = { 'Content-Type': 'application/json' };
    if (s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;
    var history = this.msgs.filter(function (m) { return m.content && !m.error; }).slice(-14).map(function (m) { return { role: m.role, content: m.content.slice(0, 1500) }; });
    var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, 40000);
    fetch(this.o.endpoint, { method: 'POST', headers: headers, signal: ctl.signal, body: JSON.stringify({ messages: history, language: this.lang, languageLocked: this.locked, state: this.state, context: this.o.getContext ? this.o.getContext() : {} }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw { user: x.j.error || 'Something went wrong. Please try again.' };
        var j = x.j;
        self.state = j.state || self.state;
        if (j.language && !self.locked && j.language !== self.lang) { self.lang = j.language; if (self.sel) self.sel.value = j.language; }
        self.msgs.push({ role: 'assistant', content: j.reply, cards: j.cards || [], actions: j.actions || [], ticket: j.ticket ? { token: j.ticket.token, preview: j.ticket.preview, state: 'pending' } : null });
      })
      .catch(function (e) {
        var text = e && e.user ? e.user : (e && e.name === 'AbortError' ? 'That took too long. Please try again.' : 'I could not reach the assistant. Check your connection and try again.');
        self.msgs.push({ role: 'assistant', content: text, error: true });
      })
      .then(function () {
        clearTimeout(timer); self.busy = false; self._save();
        if (self.isOpen) { self._render(); self.input.focus({ preventScroll: true }); }
      });
  };

  Pcx.Assistant = Assistant;
  Pcx.Assistant._renderText = renderText;
})(window);
