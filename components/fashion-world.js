/* Pcx.FashionWorld + Pcx.FashionCatsPage
 * The dedicated Fashion world (#world=fashion) and its "See all categories" page (#fcats).
 *
 * A fashion-first shopping surface built entirely on the EXISTING Marcato architecture:
 *   • product cards        → the host's own cardHTML (components/product-card.js)
 *   • hero ads carousel    → the existing PromotionalCarousel (image + GIF, autoplay, swipe)
 *   • gender selector      → compact portrait cards fed by `fashion_genders` (admin-managed
 *                            media: image or GIF, shown whole — never cropped or stretched)
 *   • categories           → CIRCULAR tiles from the `categories` rows tagged world
 *                            'fashion'/'both'; tapping opens the existing category page
 *   • discovery rails      → admin `fashion_sections` rows plus automatic real-data rails
 *                            (new, featured, gender, top vendors, categories); a rail with
 *                            no real products hides itself — nothing is ever faked
 *   • shop-the-world grid  → the same cards in a 3-per-row grid or a list layout, with
 *                            category / gender / price / availability filters
 *
 *   const fw = new Pcx.FashionWorld(document.getElementById('fashionPage'), deps);
 *   fw.open();  fw.close();  fw.isOpen();
 *
 *   const cp = new Pcx.FashionCatsPage(document.getElementById('fashionCatsPage'), deps);
 *   cp.open();  cp.close();
 *
 * deps (all functions so data can be refreshed between opens):
 *   genders(){[{slug,name,media_url,accent}]}   ads(){[{id,title,image_url,href}]}
 *   sections(){[{id,title,type,category_id,vendor_id,gender,item_limit}]}
 *   tree(){Pcx.Categories.Tree|null}            products(){fashion product universe}
 *   vendor(id){vendor row|null}                 storeName(){string}
 *   cardHTML(p){html}                           fmt(n){string}
 *   onBack()  openCart()  openSearch()  openCategory(slug)  openStore(id)  toast(msg)
 *
 * Requires: promotional-carousel.js, fashion.js, product-card.css, seller-brand.css,
 *           fashion-world.css, drag-gesture.js, promotion-slide.js.
 */
(function (global) {
  'use strict';

  var Pcx = global.Pcx = global.Pcx || {};
  var F = Pcx.Fashion;

  var BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
  var CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  var SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M11 6C13.7614 6 16 8.23858 16 11M16.6588 16.6549L21 21M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CART_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7.5 18C8.32843 18 9 18.6716 9 19.5C9 20.3284 8.32843 21 7.5 21C6.67157 21 6 20.3284 6 19.5C6 18.6716 6.67157 18 7.5 18Z" stroke="currentColor" stroke-width="1.5"/><path d="M16.5 18.0001C17.3284 18.0001 18 18.6716 18 19.5001C18 20.3285 17.3284 21.0001 16.5 21.0001C15.6716 21.0001 15 20.3285 15 19.5001C15 18.6716 15.6716 18.0001 16.5 18.0001Z" stroke="currentColor" stroke-width="1.5"/><path d="M2 3L2.26121 3.09184C3.5628 3.54945 4.2136 3.77826 4.58584 4.32298C4.95808 4.86771 4.95808 5.59126 4.95808 7.03836V9.76C4.95808 12.7016 5.02132 13.6723 5.88772 14.5862C6.75412 15.5 8.14857 15.5 10.9375 15.5H12M16.2404 15.5C17.8014 15.5 18.5819 15.5 19.1336 15.0504C19.6853 14.6008 19.8429 13.8364 20.158 12.3075L20.6578 9.88275C21.0049 8.14369 21.1784 7.27417 20.7345 6.69708C20.2906 6.12 18.7738 6.12 17.0888 6.12H11.0235M4.95808 6.12H7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  var GRID_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  var LIST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
  var MALE_ICON = '<circle cx="10" cy="14" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 4h-5m5 0v5m0-5l-6.5 6.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>';
  var FEMALE_ICON = '<circle cx="12" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 14.5V21M8.5 18h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>';
  var KID_ICON = '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(v) { return (global.safeUrl ? global.safeUrl(v) : ''); }
  function discountOf(p) {
    return p.original_price && Number(p.original_price) > Number(p.price)
      ? Math.round((1 - Number(p.price) / Number(p.original_price)) * 100) : 0;
  }
  var GENDER_ICONS = { men: MALE_ICON, women: FEMALE_ICON, boys: KID_ICON, girls: KID_ICON };
  var GENDER_TITLES = { men: "Men's Fashion", women: "Women's Fashion", boys: "Boys' Fashion", girls: "Girls' Fashion" };

  /* ================================================================== RAILS */

  /* Resolves one admin section row (or auto rule) to { key, title, prods, more } or null. */
  function resolveSection(tree, universe, vendorsMap, row) {
    var type = row.type, limit = Math.max(1, parseInt(row.item_limit, 10) || 12);
    var prods = [], more = null;

    if (type === 'category') {
      var cat = row.category_id != null && tree ? tree.byId[row.category_id] : null;
      if (!cat || !tree.isVisible(cat.id)) return null;
      var m = tree.productMatcher(cat.id);
      prods = universe.filter(m);
      more = { kind: 'category', slug: cat.slug };
    } else if (type === 'vendor') {
      var v = row.vendor_id ? vendorsMap[row.vendor_id] : null;
      if (!v) return null;
      prods = universe.filter(function (p) { return (p.vendor_id || null) === row.vendor_id; });
      more = { kind: 'store', vendor: v };
    } else if (type === 'gender') {
      if (!row.gender || !GENDER_TITLES[row.gender]) return null;
      prods = universe.filter(function (p) { return F.matchesGender(p, row.gender); });
      more = { kind: 'gender', slug: row.gender };
    } else if (type === 'new') {
      prods = universe.slice();
    } else if (type === 'featured') {
      prods = universe.filter(function (p) { return p.featured; });
    } else if (type === 'sale') {
      prods = universe.filter(function (p) { return discountOf(p) > 0; })
        .sort(function (a, b) { return discountOf(b) - discountOf(a); });
    }
    prods = prods.slice(0, limit);
    if (!prods.length) return null;
    return {
      key: row.key,
      title: row.title,
      vendor: type === 'vendor' ? vendorsMap[row.vendor_id] : null,
      prods: prods,
      more: more
    };
  }

  /* Admin rows first (in order), then automatic real-data rails. Duplicate coverage
     (same category / vendor / gender) is not rendered twice. */
  function buildRails(tree, universe, vendorsMap, sectionRows) {
    var out = [], covered = { category: {}, vendor: {}, gender: {}, kind: {} };
    var idCount = 0;

    (sectionRows || []).forEach(function (row) {
      var key = 'admin-' + row.id;
      var r = resolveSection(tree, universe, vendorsMap, Object.assign({}, row, { key: key }));
      if (!r) return;
      if (row.type === 'category' && row.category_id != null) covered.category[row.category_id] = 1;
      if (row.type === 'vendor' && row.vendor_id) covered.vendor[row.vendor_id] = 1;
      if (row.type === 'gender' && row.gender) covered.gender[row.gender] = 1;
      covered.kind[row.type] = 1;
      out.push(r);
    });

    if (!covered.kind.new && universe.length >= 4) {
      var newest = resolveSection(tree, universe, vendorsMap, { type: 'new', title: 'New Fashion Finds', item_limit: 12, key: 'auto-new' });
      if (newest) out.push(newest);
    }
    if (!covered.kind.featured) {
      var featured = resolveSection(tree, universe, vendorsMap, { type: 'featured', title: 'Trending in Fashion', item_limit: 12, key: 'auto-featured' });
      if (featured) out.push(featured);
    }
    if (!covered.kind.sale) {
      var sale = resolveSection(tree, universe, vendorsMap, { type: 'sale', title: 'On Sale', item_limit: 12, key: 'auto-sale' });
      if (sale) out.push(sale);
    }
    ['women', 'men', 'boys', 'girls'].forEach(function (g) {
      if (covered.gender[g]) return;
      var r = resolveSection(tree, universe, vendorsMap, { type: 'gender', gender: g, title: GENDER_TITLES[g], item_limit: 12, key: 'auto-g-' + g });
      if (r) out.push(r);
    });
    /* top vendors by real product count */
    var byVendor = {};
    universe.forEach(function (p) { if (p.vendor_id) byVendor[p.vendor_id] = (byVendor[p.vendor_id] || 0) + 1; });
    Object.keys(byVendor)
      .sort(function (a, b) { return byVendor[b] - byVendor[a]; })
      .slice(0, 2)
      .forEach(function (vid) {
        if (covered.vendor[vid]) return;
        var v = vendorsMap[vid];
        if (!v) return;
        var r = resolveSection(tree, universe, vendorsMap, {
          type: 'vendor', vendor_id: vid, title: 'Popular from ' + (v.business_name || 'Seller'),
          item_limit: 12, key: 'auto-v-' + vid
        });
        if (r) out.push(r);
      });
    /* category rails */
    (tree ? F.fashionRoots(tree) : []).forEach(function (cat) {
      if (covered.category[cat.id]) return;
      var r = resolveSection(tree, universe, vendorsMap, { type: 'category', category_id: cat.id, title: cat.name, item_limit: 12, key: 'auto-c-' + cat.id });
      if (r) out.push(r);
    });
    return out;
  }

  /* ================================================================== FASHION WORLD */

  function FashionWorld(root, deps) {
    this.root = root;
    this.d = deps;
    this.gender = null;
    this.layout = 'grid';
    this.catId = null;
    this.sort = 'new';
    this.inStock = false;
    this.carousel = null;
    this.built = false;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-hidden', 'true');
  }

  var P = FashionWorld.prototype;

  P.isOpen = function () { return this.root.classList.contains('open'); };

  P.open = function () {
    if (!this.built) { this._build(); this.built = true; }
    if (this.isOpen()) { this.renderAll(); return; }   /* e.g. back from a category page: refresh, keep scroll */
    this.renderAll();
    this.root.scrollTop = 0;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  P.close = function () {
    if (!this.isOpen()) return;
    this._killCarousel();
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  P._killCarousel = function () {
    if (this.carousel) { this.carousel.destroy(); this.carousel = null; }
  };

  P._build = function () {
    var self = this, root = this.root, d = this.d;
    root.textContent = '';

    /* header */
    var hdr = h('header', 'fw-hdr');
    var back = h('button', 'fw-back'); back.type = 'button'; back.setAttribute('aria-label', 'Back'); back.innerHTML = BACK;
    back.addEventListener('click', function () { d.onBack(); });
    var word = h('div', 'fw-word', 'Fashion');
    var searchBtn = h('button', 'hdr-icon'); searchBtn.type = 'button'; searchBtn.setAttribute('aria-label', 'Search'); searchBtn.innerHTML = SEARCH_ICON;
    searchBtn.addEventListener('click', function () { d.openSearch(); });
    var cartBtn = h('button', 'hdr-icon fw-cartbtn'); cartBtn.type = 'button'; cartBtn.setAttribute('aria-label', 'Cart'); cartBtn.innerHTML = CART_ICON;
    var cartDot = h('span'); cartDot.id = 'fwCartDot';
    cartBtn.appendChild(cartDot);
    cartBtn.addEventListener('click', function () { d.openCart(); });
    hdr.appendChild(back); hdr.appendChild(word); hdr.appendChild(searchBtn); hdr.appendChild(cartBtn);
    root.appendChild(hdr);

    /* search bar */
    var sw = h('div', 'fw-searchWrap');
    var bar = h('div', 'fw-search'); bar.setAttribute('role', 'button'); bar.setAttribute('aria-label', 'Search fashion');
    bar.innerHTML = SEARCH_ICON;
    var ph = h('span', null, 'Search fashion, brands and sellers');
    bar.appendChild(ph);
    bar.addEventListener('click', function () { d.openSearch(); });
    sw.appendChild(bar);
    root.appendChild(sw);

    /* dynamic zones */
    this.zGenders = h('section', 'fw-gwrap'); root.appendChild(this.zGenders);
    this.zHero = h('section', 'fw-heroWrap'); root.appendChild(this.zHero);
    this.zCats = h('section'); root.appendChild(this.zCats);
    this.zRails = h('div'); root.appendChild(this.zRails);
    this.zShop = h('section'); root.appendChild(this.zShop);
    this.zEmpty = h('div'); root.appendChild(this.zEmpty);
  };

  P.renderAll = function () {
    this.renderGenders();
    this.renderHero();
    this.renderCats();
    this.renderRails();
    this.renderShop();
  };

  /* ── gender cards ─────────────────────────────────── */
  P.renderGenders = function () {
    var self = this, z = this.zGenders, genders = this.d.genders() || [];
    z.textContent = '';
    z.hidden = !genders.length;
    if (!genders.length) return;
    var row = h('div', 'fw-genderRow');
    genders.forEach(function (g) {
      var on = self.gender === g.slug;
      var card = h('button', 'fw-g' + (on ? ' on' : '') + (g.media_url ? ' has-media' : ''));
      card.type = 'button';
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (g.accent) card.style.setProperty('--fw-accent', g.accent);
      if (g.media_url) {
        var media = h('span', 'fw-g-media');
        var img = new Image();
        img.alt = ''; img.loading = 'lazy'; img.draggable = false; img.decoding = 'async';
        img.src = safeUrl(g.media_url);
        media.appendChild(img);
        card.appendChild(media);
      } else if (GENDER_ICONS[g.slug]) {
        var media = h('span', 'fw-g-media');
        var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('class', 'fw-g-ph-icon');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = GENDER_ICONS[g.slug];
        media.appendChild(icon);
        card.appendChild(media);
      }
      card.appendChild(h('span', 'fw-g-name', g.name || g.slug));
      card.addEventListener('click', function () {
        var wasOn = self.gender === g.slug;    /* computed at tap time: tap the active card again to clear */
        self.gender = wasOn ? null : g.slug;
        self.renderGenders();
        self.renderRails();
        self.renderShop();
      });
      row.appendChild(card);
    });
    z.appendChild(row);
  };

  /* ── hero ads carousel ────────────────────────────── */
  P.renderHero = function () {
    var z = this.zHero, ads = this.d.ads() || [];
    this._killCarousel();
    z.textContent = '';
    z.hidden = !ads.length;
    if (!ads.length) return;
    var promos = ads.map(function (a) {
      return {
        id: 'fwad-' + a.id,
        image: a.image_url || '',
        title: a.title || '',
        href: a.href || '',
        accent: ''
      };
    }).filter(function (p) { return p.image; });
    if (!promos.length) { z.hidden = true; return; }
    z.hidden = false;
    var host = h('div'); host.id = 'fwHero';
    z.appendChild(host);
    this.carousel = new PromotionalCarousel(host, { promotions: promos, ariaLabel: 'Fashion highlights' });
  };

  /* ── circular categories ──────────────────────────── */
  P.renderCats = function () {
    var self = this, z = this.zCats, tree = this.d.tree();
    var cats = tree ? F.fashionRoots(tree) : [];
    z.textContent = '';
    z.hidden = !cats.length;
    if (!cats.length) return;

    var hd = h('div', 'fw-secHd');
    var ttlWrap = h('div');
    ttlWrap.appendChild(h('span', 'fw-secTtl', 'Shop by Category'));
    hd.appendChild(ttlWrap);
    if (cats.length > 10) {
      var seeAll = h('button', 'fw-seeAll'); seeAll.type = 'button';
      seeAll.innerHTML = 'See all ' + CHEV;
      seeAll.addEventListener('click', function () { self.d.openAllCategories(); });
      hd.appendChild(seeAll);
    }
    z.appendChild(hd);

    var grid = h('div', 'fw-cats');
    cats.slice(0, 10).forEach(function (c) { grid.appendChild(catCircle(c, function () { self.d.openCategory(c.slug); })); });
    z.appendChild(grid);
  };

  function catCircle(c, onOpen) {
    var cat = h('button', 'fw-cat'); cat.type = 'button';
    var circle = h('span', 'fw-cat-circle');
    if (c.color) circle.style.setProperty('--fw-cat-bg', c.color);
    var url = (global.Pcx && Pcx.Categories) ? Pcx.Categories.imageUrl(c) : (c.imageUrl || '');
    if (url) {
      var img = new Image();
      img.alt = ''; img.loading = 'lazy'; img.draggable = false; img.decoding = 'async';
      img.src = safeUrl(url);
      circle.appendChild(img);
    } else {
      circle.appendChild(h('span', 'fw-cat-ph', (String(c.name || '?').charAt(0) || '?').toUpperCase()));
    }
    cat.appendChild(circle);
    cat.appendChild(h('span', 'fw-cat-name', c.name || ''));
    cat.addEventListener('click', onOpen);
    return cat;
  }

  /* ── discovery rails ──────────────────────────────── */
  P.renderRails = function () {
    var self = this, z = this.zRails, tree = this.d.tree();
    var universe = this.universe();
    var vendorsMap = this.d.vendorsMap ? this.d.vendorsMap() : {};
    var rails = buildRails(tree, universe, vendorsMap, this.d.sections() || []);
    z.textContent = '';
    z.hidden = !rails.length;
    if (!rails.length) return;

    rails.forEach(function (r) {
      var sec = h('section');
      var hd;
      if (r.vendor) {
        hd = h('div', 'fw-vendorHead');
        var av = h('span');
        av.style.cssText = 'width:30px;height:30px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--txt2)';
        if (r.vendor.logo_url) {
          var img = new Image(); img.alt = ''; img.src = safeUrl(r.vendor.logo_url);
          img.style.cssText = 'width:100%;height:100%;object-fit:cover';
          av.appendChild(img);
        } else {
          av.textContent = ((r.vendor.business_name || '?')[0] || '?').toUpperCase();
        }
        hd.appendChild(av);
        hd.appendChild(h('span', 'fw-railName', r.title));
        var moreV = h('button', 'fw-railMore'); moreV.type = 'button';
        moreV.innerHTML = 'See more ' + CHEV;
        moreV.addEventListener('click', function () { self.d.openStore(r.vendor.store_slug || r.vendor.id); });
        hd.appendChild(moreV);
      } else {
        hd = h('div', 'fw-railHd');
        hd.appendChild(h('span', 'fw-railBar'));
        hd.appendChild(h('span', 'fw-railName', r.title));
        hd.appendChild(h('span', 'fw-railCount', r.prods.length + ' item' + (r.prods.length !== 1 ? 's' : '')));
        if (r.more && r.more.kind === 'category' && r.more.slug) {
          var moreC = h('button', 'fw-railMore'); moreC.type = 'button';
          moreC.innerHTML = 'See more ' + CHEV;
          moreC.addEventListener('click', function () { self.d.openCategory(r.more.slug); });
          hd.appendChild(moreC);
        }
        if (r.more && r.more.kind === 'gender') {
          var moreG = h('button', 'fw-railMore'); moreG.type = 'button';
          moreG.innerHTML = 'See all ' + CHEV;
          moreG.addEventListener('click', function () {
            self.gender = r.more.slug;
            self.renderGenders(); self.renderRails(); self.renderShop();
            self.zShop.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
          hd.appendChild(moreG);
        }
      }
      sec.appendChild(hd);
      var rail = h('div', 'fw-rail');
      r.prods.forEach(function (p) {
        var w = h('div', 'fcard-wrap');
        w.innerHTML = self.d.cardHTML(p);
        rail.appendChild(w);
      });
      sec.appendChild(rail);
      z.appendChild(sec);
    });
  };

  /* ── shop-the-world (filters + grid/list) ─────────── */
  P.universe = function () { return this.d.products() || []; };

  P.filtered = function () {
    var self = this, tree = this.d.tree();
    var list = this.universe().filter(function (p) { return F.matchesGender(p, self.gender); });
    if (this.catId != null && tree) {
      var match = tree.productMatcher(this.catId);
      list = list.filter(match);
    }
    if (this.inStock) list = list.filter(function (p) { return Number(p.stock) > 0; });
    if (this.sort === 'price_asc') list = list.slice().sort(function (a, b) { return Number(a.price) - Number(b.price); });
    else if (this.sort === 'price_desc') list = list.slice().sort(function (a, b) { return Number(b.price) - Number(a.price); });
    else if (this.sort === 'discount') list = list.slice().sort(function (a, b) { return discountOf(b) - discountOf(a); });
    return list;
  };

  P.renderShop = function () {
    var self = this, z = this.zShop, empty = this.zEmpty, tree = this.d.tree();
    var cats = tree ? F.fashionRoots(tree) : [];
    var universe = this.universe();
    z.textContent = ''; empty.textContent = '';

    if (!universe.length) {
      empty.hidden = false;
      var e = h('div', 'fw-empty');
      e.appendChild(h('h3', null, 'Fashion is being curated'));
      e.appendChild(h('p', null, 'Real products from real sellers will appear here as soon as they are listed. Check back soon.'));
      empty.appendChild(e);
      return;
    }

    /* header + layout toggle */
    var hd = h('div', 'fw-shopHd');
    var ttl = h('div');
    ttl.appendChild(h('span', 'fw-secTtl', 'All Fashion'));
    hd.appendChild(ttl);
    var tgl = h('div', 'fw-layTgl');
    var gb = h('button', this.layout === 'grid' ? 'on' : ''); gb.type = 'button'; gb.setAttribute('aria-label', 'Grid layout'); gb.innerHTML = GRID_ICON;
    var lb = h('button', this.layout === 'list' ? 'on' : ''); lb.type = 'button'; lb.setAttribute('aria-label', 'List layout'); lb.innerHTML = LIST_ICON;
    gb.addEventListener('click', function () { self.layout = 'grid'; self.renderShop(); });
    lb.addEventListener('click', function () { self.layout = 'list'; self.renderShop(); });
    tgl.appendChild(gb); tgl.appendChild(lb);
    hd.appendChild(tgl);
    z.appendChild(hd);

    /* category chips */
    if (cats.length) {
      var crow = h('div', 'fw-chipRow');
      var all = h('button', 'fw-chip' + (this.catId == null ? ' on' : '')); all.type = 'button'; all.textContent = 'All';
      all.addEventListener('click', function () { self.catId = null; self.renderShop(); });
      crow.appendChild(all);
      cats.forEach(function (c) {
        var on = self.catId === c.id;
        var chip = h('button', 'fw-chip' + (on ? ' on' : '')); chip.type = 'button'; chip.textContent = c.name;
        chip.addEventListener('click', function () { self.catId = on ? null : c.id; self.renderShop(); });
        crow.appendChild(chip);
      });
      z.appendChild(crow);
    }

    /* sort + availability chips */
    var sorts = [['new', 'Newest'], ['price_asc', 'Price \u2191'], ['price_desc', 'Price \u2193'], ['discount', 'Biggest discount']];
    var srow = h('div', 'fw-chipRow');
    sorts.forEach(function (s) {
      var on = self.sort === s[0];
      var chip = h('button', 'fw-chip' + (on ? ' on' : '')); chip.type = 'button'; chip.textContent = s[1];
      chip.addEventListener('click', function () { self.sort = s[0]; self.renderShop(); });
      srow.appendChild(chip);
    });
    var stock = h('button', 'fw-chip' + (this.inStock ? ' on' : '')); stock.type = 'button'; stock.textContent = 'In stock';
    stock.addEventListener('click', function () { self.inStock = !self.inStock; self.renderShop(); });
    srow.appendChild(stock);
    z.appendChild(srow);

    /* the grid (reuses the ONE product card system) */
    var list = this.filtered();
    var grid = h('div', 'fwGrid' + (this.layout === 'list' ? ' list' : ''));
    if (!list.length) {
      var msg = h('div', 'fw-empty');
      msg.style.gridColumn = '1/-1';
      msg.appendChild(h('h3', null, 'Nothing matches yet'));
      msg.appendChild(h('p', null, 'Try another category, gender or filter.'));
      grid.appendChild(msg);
    } else {
      list.forEach(function (p, i) {
        var w = h('div', 'fcard-wrap');
        w.innerHTML = '<div class="au d' + Math.min(i % 4, 3) + '">' + self.d.cardHTML(p) + '</div>';
        grid.appendChild(w);
      });
    }
    z.appendChild(grid);
    if (this.d.afterRender) this.d.afterRender(grid);
  };

  Pcx.FashionWorld = FashionWorld;
  Pcx.FashionWorld.catCircle = catCircle;
  Pcx.FashionWorld.buildRails = buildRails;

  /* ================================================================== ALL-CATEGORIES PAGE */

  function FashionCatsPage(root, deps) {
    this.root = root;
    this.d = deps;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="fcpg-hdr"><button class="fw-back" type="button" aria-label="Back">' + BACK + '</button>' +
      '<div class="fw-word">All Categories</div></div>' +
      '<div class="fcpg-sub">Every category in the Fashion world. Tap one to see only its products.</div>' +
      '<div class="fcpg-grid"></div>';
    var self = this;
    root.querySelector('.fw-back').addEventListener('click', function () { self.d.onBack(); });
  }

  var C = FashionCatsPage.prototype;

  C.isOpen = function () { return this.root.classList.contains('open'); };

  C.open = function () {
    if (this.isOpen()) return;
    var tree = this.d.tree();
    var cats = tree ? F.fashionRoots(tree) : [];
    var grid = this.root.querySelector('.fcpg-grid');
    grid.textContent = '';
    if (!cats.length) {
      var e = h('div', 'fw-empty'); e.style.gridColumn = '1/-1';
      e.appendChild(h('h3', null, 'No categories yet'));
      e.appendChild(h('p', null, 'Fashion categories will appear here once they are set up.'));
      grid.appendChild(e);
    } else {
      cats.forEach(function (c) { grid.appendChild(Pcx.FashionWorld.catCircle(c, function () { })); });
    }
    /* wire taps after mount (catCircle binds a noop so the grid can also be reused) */
    var self = this, buttons = grid.querySelectorAll('.fw-cat');
    cats.forEach(function (c, i) {
      buttons[i].addEventListener('click', function () { self.d.openCategory(c.slug); });
    });
    this.root.scrollTop = 0;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  C.close = function () {
    if (!this.isOpen()) return;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  Pcx.FashionCatsPage = FashionCatsPage;
})(window);
