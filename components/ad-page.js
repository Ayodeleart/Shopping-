/* Pcx.AdPage
 * Full-screen page opened from an ad in the home feed (#ad=ID) or from a hero banner (#promo=ID).
 * It takes a "campaign": an ad row from data/ads.js, or campaignFromBanner() for a banner that opens a product page.
 * Layout follows a brand store page: brand logo with section links, auto-advancing hero, then the
 * sections the admin arranged (product rails, feature cards, banners, video, text) and a contact footer.
 * It reuses the storefront's own product card, cart and product modal through the injected `deps`.
 *
 *   const page = new Pcx.AdPage(document.getElementById('adPage'), {
 *     products: () => allProds,          // every product
 *     cardHTML: p => '<div class="pcard">…',
 *     openProduct: id => {},
 *     openCart: () => {},
 *     phone: () => storePhone,
 *     onBack: () => {}
 *   });
 *   page.open(ad);  page.close();
 *
 * Requires: promotional-carousel.js, data/ads.js, components/ad-page.css
 */
(function (global) {
  'use strict';

  var ns = global.Pcx = global.Pcx || {};

  var BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  var CHEV_L = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var MAIL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>';
  var PHONE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z"/></svg>';
  var PLAY = '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="8 5 19 12 8 19 8 5"/></svg>';

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* paragraphs on blank lines, **bold** for emphasis; everything is escaped first */
  function richText(body) {
    return String(body || '').split(/\n\s*\n/).map(function (par) {
      return '<p>' + esc(par.trim()).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function youtubeId(url) {
    var m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/.exec(url || '');
    return m ? m[1] : null;
  }

  function safeUrl(u) {
    try {
      var x = new URL(u, location.href);
      return /^https?:$/.test(x.protocol) ? x : null;
    } catch (_) { return null; }
  }

  function AdPage(root, deps) {
    this.root = root;
    this.d = deps;
    this.ad = null;
    this.carousels = [];
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-hidden', 'true');
  }

  var P = AdPage.prototype;

  P.isOpen = function () { return this.root.classList.contains('open'); };

  P.open = function (ad) {
    if (this.ad && String(this.ad.id) === String(ad.id) && this.isOpen()) return;
    this._teardown();
    this.ad = ad;
    this._build(ad);
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
    var self = this;
    /* keep the content while the slide-out plays, then release the carousels */
    setTimeout(function () { if (!self.isOpen()) self._teardown(); }, 360);
  };

  P._teardown = function () {
    this.carousels.forEach(function (c) { try { c.destroy(); } catch (_) {} });
    this.carousels = [];
    this.root.textContent = '';
    this.ad = null;
  };

  /* ── build ── */

  P._build = function (ad) {
    var self = this, root = this.root, d = this.d;
    root.style.setProperty('--adp-accent', ad.accent || '#3f4468');

    /* header */
    var hdr = h('header', 'adp-hdr');
    var back = h('button', 'adp-back'); back.type = 'button'; back.setAttribute('aria-label', 'Back'); back.innerHTML = BACK;
    back.addEventListener('click', function () { d.onBack(); });
    var ttl = h('span', 'adp-title', ad.name);
    var cart = h('button', 'adp-cart'); cart.type = 'button'; cart.setAttribute('aria-label', 'Cart');
    var cartSvg = document.querySelector('#cartBtn svg');
    if (cartSvg) cart.appendChild(cartSvg.cloneNode(true));
    var dot = h('span'); dot.id = 'adCartDot'; cart.appendChild(dot);
    cart.addEventListener('click', function () { d.openCart(); });
    hdr.appendChild(back);
    if (d.onHome) {                       /* store logo: back to the home page from here */
      var home = h('button', 'adp-home'); home.type = 'button'; home.setAttribute('aria-label', 'Home');
      var logo = document.createElement('img'); logo.src = 'store-logo.png'; logo.alt = '';
      home.appendChild(logo);
      home.addEventListener('click', function () { d.onHome(); });
      hdr.appendChild(home);
    }
    hdr.appendChild(ttl); hdr.appendChild(cart);
    root.appendChild(hdr);

    /* sections (fall back to "everything from this brand" so a bare ad still works) */
    var sections = ad.page.sections.length ? ad.page.sections : [{ type: 'products', title: ad.brand || ad.name, mode: 'auto', layout: 'grid', showEmpty: true }];
    var built = [];
    sections.forEach(function (sec, i) {
      var el = self._section(ad, sec, i);
      if (el) built.push({ sec: sec, el: el, i: i });
    });

    /* brand block: logo + links to product sections */
    var brand = h('div', 'adp-brand');
    if (ad.logo) {
      var logo = h('img', 'adp-logo'); logo.alt = ad.brand || ad.name;
      logo.addEventListener('error', function () { logo.replaceWith(h('div', 'adp-brandname', ad.brand || ad.name)); });   // a dead logo link falls back to the name
      logo.src = safeHref(ad.logo); brand.appendChild(logo);
    } else {
      brand.appendChild(h('div', 'adp-brandname', ad.brand || ad.name));
    }
    if (ad.tagline) brand.appendChild(h('p', 'adp-tagline', ad.tagline));
    var navItems = built.filter(function (b) { return b.sec.type === 'products' && b.sec.title && b.sec.nav !== false; });
    if (navItems.length > 1) {
      var nav = h('nav', 'adp-links');
      navItems.forEach(function (b) {
        var a = h('button', 'adp-link', b.sec.title); a.type = 'button';
        a.addEventListener('click', function () { b.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        nav.appendChild(a);
      });
      brand.appendChild(nav);
    }
    root.appendChild(brand);

    /* hero */
    if (ad.page.hero.length) root.appendChild(this._hero(ad));

    built.forEach(function (b) { root.appendChild(b.el); });
    root.appendChild(this._footer(ad));
    global.Pcx.AdPage.refreshCartDot && global.Pcx.AdPage.refreshCartDot();
  };

  P._hero = function (ad) {
    var box = h('div', 'adp-hero');
    var promos = ad.page.hero.map(function (s) {
      return { image: s.image, href: s.href || '', alt: s.alt || ad.name };
    });
    var c = new global.PromotionalCarousel(box, { promotions: promos, variant: 'flat', interval: 4500, ariaLabel: ad.name });
    this.carousels.push(c);
    /* size the hero to the artwork so nothing is cropped */
    var im = new Image();
    im.onload = function () {
      var r = im.naturalWidth / im.naturalHeight;
      if (r > 0) box.style.setProperty('--pcx-ratio', Math.min(3.2, Math.max(1.3, r)).toFixed(3) + ' / 1');
    };
    im.src = safeHref(promos[0].image);
    return box;
  };

  P._section = function (ad, sec, i) {
    switch (sec.type) {
      case 'products': return this._products(ad, sec, i);
      case 'cards': return this._cards(sec);
      case 'banner': return this._banner(sec);
      case 'video': return this._video(sec);
      case 'text': return this._text(sec);
      default: return null;
    }
  };

  P._go = function (t) {
    if (!t) return;
    if (t.product_id) { this.d.openProduct(Number(t.product_id)); return; }
    var u = t.href && safeUrl(t.href);
    if (!u) return;
    if (u.origin === location.origin) location.href = u.href; else global.open(u.href, '_blank', 'noopener');
  };

  P._products = function (ad, sec, i) {
    var d = this.d;
    var prods = global.Ads.productsFor(ad, sec, d.products());
    if (!prods.length && !sec.showEmpty) return null;
    var el = h('section', 'adp-sec'); el.id = 'adp-s-' + i;

    var band = h('div', 'adp-band');
    band.appendChild(h('h3', 'adp-band__t', sec.title || ad.brand || 'Products'));
    if (!prods.length) {
      el.appendChild(band);
      el.appendChild(h('div', 'adp-empty', 'No products match this yet. Check back soon.'));
      return el;
    }
    var wrap = h('div', 'adp-rail-wrap' + (sec.layout === 'grid' ? ' is-grid' : ''));
    if (sec.layout === 'grid') {
      band.appendChild(h('span', 'adp-count', prods.length + ' item' + (prods.length === 1 ? '' : 's')));
    } else if (prods.length > 2) {
      var more = h('button', 'adp-more'); more.type = 'button';
      more.innerHTML = '<span>See more</span><i>' + CHEV + '</i>';
      more.addEventListener('click', function () {
        var grid = wrap.classList.toggle('is-grid');
        more.firstChild.textContent = grid ? 'See less' : 'See more';
        if (!grid) rail.scrollLeft = 0;
      });
      band.appendChild(more);
    }
    el.appendChild(band);

    var rail = h('div', 'adp-rail');
    rail.innerHTML = prods.map(function (p) { return '<div class="adp-cell">' + d.cardHTML(p) + '</div>'; }).join('');
    wrap.appendChild(rail);
    if (sec.layout !== 'grid') {
      ['prev', 'next'].forEach(function (dir) {
        var b = h('button', 'adp-arrow adp-arrow--' + dir); b.type = 'button';
        b.setAttribute('aria-label', dir === 'prev' ? 'Scroll back' : 'Scroll forward');
        b.innerHTML = dir === 'prev' ? CHEV_L : CHEV;
        b.addEventListener('click', function () { rail.scrollBy({ left: (dir === 'prev' ? -1 : 1) * rail.clientWidth * 0.85, behavior: 'smooth' }); });
        wrap.appendChild(b);
      });
    }
    el.appendChild(wrap);
    return el;
  };

  P._cards = function (sec) {
    var self = this;
    var items = (sec.items || []).filter(function (it) { return it && (it.title || it.image); });
    if (!items.length) return null;
    var el = h('section', 'adp-sec adp-cards');
    items.forEach(function (it) {
      var card = h('div', 'adp-fcard');
      if (it.product_id || it.href) { card.setAttribute('role', 'link'); card.tabIndex = 0; }
      if (it.title) card.appendChild(h('h4', 'adp-fcard__t', it.title));
      if (it.image) {
        var box = h('div', 'adp-fcard__img'); var im = h('img'); im.alt = it.title || ''; im.loading = 'lazy'; im.src = safeHref(it.image); box.appendChild(im); card.appendChild(box);
      }
      if (it.product_id || it.href) {
        var btn = h('span', 'adp-black', it.button || 'Buy Now'); card.appendChild(btn);
        card.addEventListener('click', function () { self._go(it); });
        card.addEventListener('keydown', function (e) { if (e.key === 'Enter') self._go(it); });
      }
      el.appendChild(card);
    });
    return el;
  };

  P._banner = function (sec) {
    if (!sec.image) return null;
    var self = this;
    var el = h('section', 'adp-sec adp-banner');
    var im = h('img'); im.alt = sec.title || ''; im.loading = 'lazy'; im.src = safeHref(sec.image); el.appendChild(im);
    if (sec.product_id || sec.href) {
      el.classList.add('is-link'); el.setAttribute('role', 'link'); el.tabIndex = 0;
      el.addEventListener('click', function () { self._go(sec); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') self._go(sec); });
    }
    return el;
  };

  P._video = function (sec) {
    var id = youtubeId(sec.url);
    var direct = !id && safeUrl(sec.url);
    if (!id && !direct) return null;
    var el = h('section', 'adp-sec adp-video');
    var box = h('div', 'adp-vbox');
    if (id) {
      var im = h('img'); im.alt = ''; im.loading = 'lazy'; im.addEventListener('error', function () { im.remove(); }); im.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; box.appendChild(im);
      var play = h('button', 'adp-play'); play.type = 'button'; play.setAttribute('aria-label', 'Play video'); play.innerHTML = PLAY;
      play.addEventListener('click', function () {
        box.textContent = '';
        var f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1';
        f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        f.allowFullscreen = true; f.title = sec.title || 'Video';
        box.appendChild(f);
      });
      box.appendChild(play);
    } else {
      var v = document.createElement('video');
      v.controls = true; v.playsInline = true; v.preload = 'metadata'; v.src = safeHref(direct.href);
      box.appendChild(v);
    }
    el.appendChild(box);
    return el;
  };

  P._text = function (sec) {
    if (!sec.title && !sec.body) return null;
    var el = h('section', 'adp-sec adp-text');
    if (sec.title) el.appendChild(h('h2', 'adp-text__t', sec.title));
    var body = h('div', 'adp-text__b'); body.innerHTML = richText(sec.body); el.appendChild(body);
    return el;
  };

  P._footer = function (ad) {
    var c = ad.page.contact || {};
    var phone = c.phone || (this.d.phone && this.d.phone()) || '';
    var foot = h('footer', 'adp-foot');
    function row(icon, label, value, href) {
      var r = h('div', 'adp-foot__row');
      var i = h('span', 'adp-foot__ico'); i.innerHTML = icon; r.appendChild(i);
      var t = h('div'); t.appendChild(h('div', 'adp-foot__lbl', label));
      var v = h(href ? 'a' : 'div', 'adp-foot__val', value); if (href) v.href = safeHref(href);
      t.appendChild(v); r.appendChild(t); return r;
    }
    if (c.email) foot.appendChild(row(MAIL, 'EMAIL SUPPORT', c.email, 'mailto:' + c.email));
    if (phone) foot.appendChild(row(PHONE, 'PHONE SUPPORT', phone, 'tel:' + String(phone).replace(/[^\d+]/g, '')));
    foot.appendChild(h('p', 'adp-foot__note', 'Sponsored page by ' + (ad.brand || ad.name)));
    return foot;
  };

  AdPage.refreshCartDot = function () {
    var dot = document.getElementById('adCartDot');
    var main = document.getElementById('cartDot');
    if (!dot || !main) return;
    dot.textContent = main.textContent;
    dot.style.display = main.style.display === 'flex' ? 'flex' : 'none';
  };

  ns.AdPage = AdPage;
})(window);
