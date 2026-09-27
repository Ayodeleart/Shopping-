/* Pcx.HomeDecorWorld
 *
 * The dedicated Marcato Home & Decor presentation. It adapts Ola Wood's
 * full-bleed rotating hero, editorial collection tiles, compact featured
 * cards and vertical-to-horizontal CollectionRail interaction, while every
 * item still comes from Marcato's normal products/category relationships and
 * uses Marcato's shared product-card/detail/cart/favourite handlers.
 */
(function (global) {
  'use strict';

  var Pcx = global.Pcx = global.Pcx || {};
  var HD = Pcx.HomeDecor;
  var WS = Pcx.WorldSections;
  var ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ROOM = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M11 34h42v16H11zM16 34V22a6 6 0 016-6h20a6 6 0 016 6v12M8 50h48M16 50v5M48 50v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function safe(u) { return global.safeHref ? global.safeHref(u) : String(u || ''); }
  function processed(p) { return HD && HD.processedImage ? HD.processedImage(p) : ''; }
  function display(p) { return HD && HD.displayProduct ? HD.displayProduct(p) : p; }
  function imageOf(p) { return processed(p) || (p && p.image_url) || ''; }

  function addMedia(parent, image, gif, alt, cutout, eager) {
    var still = image || gif;
    if (still) {
      var im = h('img', 'hd-media' + (cutout ? ' is-cutout' : ''));
      im.alt = alt || '';
      if (!eager) im.loading = 'lazy';
      im.decoding = 'async';
      im.src = safe(still);
      im.addEventListener('error', function () { im.remove(); });
      parent.appendChild(im);
    }
    if (image && gif) {
      var g = h('img', 'hd-media hd-media-gif');
      g.alt = alt || '';
      g.src = safe(gif);
      g.addEventListener('load', function () { g.classList.add('is-ready'); });
      g.addEventListener('error', function () { g.remove(); });
      parent.appendChild(g);
    }
  }

  function productHeroSlides(products) {
    return (products || []).filter(function (p) { return !!imageOf(p); }).slice(0, 4).map(function (p) {
      return {
        _product: p,
        title: p.name,
        subtitle: [p.brand, p.category].filter(Boolean).join(' · '),
        image_url: imageOf(p),
        cta_label: 'View this piece'
      };
    });
  }

  /* Wood's Hero fades one full-bleed image into the next. Admin world_heroes
     win; real catalogue products provide a useful fallback, never mock slides. */
  function renderHero(parent, configured, products, ctx, cleanups) {
    var slides = (configured || []).filter(function (s) { return s.image_url || s.gif_url; });
    if (!slides.length) slides = productHeroSlides(products);
    if (!slides.length) return null;

    var hero = h('section', 'hd-hero');
    hero.setAttribute('aria-roledescription', 'carousel');
    var stage = h('div', 'hd-hero-stage');
    var live = h('span', 'hd-sr', 'Slide 1 of ' + slides.length);
    stage.appendChild(live);
    var slideEls = [];

    slides.forEach(function (s, i) {
      var product = s._product;
      var cut = !!(product && processed(product));
      var slide = h('article', 'hd-hero-slide' + (i === 0 ? ' is-active' : '') + (cut ? ' has-cutout' : ''));
      slide.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
      addMedia(slide, s.image_url, s.gif_url, s.title || (product && product.name) || '', cut, i === 0);
      var shade = h('div', 'hd-hero-shade');
      var copy = h('div', 'hd-hero-copy');
      copy.appendChild(h('span', 'hd-eyebrow', 'Home & Decor'));
      copy.appendChild(h('h1', 'hd-hero-title', s.title || 'Furniture designed around how you actually live.'));
      if (s.subtitle) copy.appendChild(h('p', 'hd-hero-sub', s.subtitle));

      var action = product && ctx.openProduct
        ? function () { ctx.openProduct(product.id); }
        : (WS && WS.heroAction ? WS.heroAction(s, ctx) : null);
      if (action) {
        var cta = h('button', 'hd-hero-cta');
        cta.type = 'button';
        cta.appendChild(h('span', '', s.cta_label || 'Explore collection'));
        var icon = h('span', 'hd-icon'); icon.innerHTML = ARROW; cta.appendChild(icon);
        cta.addEventListener('click', action);
        copy.appendChild(cta);
      }
      slide.appendChild(shade);
      slide.appendChild(copy);
      stage.appendChild(slide);
      slideEls.push(slide);
    });
    hero.appendChild(stage);

    var idx = 0, timer = null, paused = false;
    function go(k) {
      idx = (k + slides.length) % slides.length;
      slideEls.forEach(function (s, i) {
        var on = i === idx;
        s.classList.toggle('is-active', on);
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
      });
      Array.prototype.forEach.call(nav.children, function (b, i) {
        b.classList.toggle('is-active', i === idx);
        b.setAttribute('aria-pressed', i === idx ? 'true' : 'false');
      });
      live.textContent = 'Slide ' + (idx + 1) + ' of ' + slides.length;
    }
    var nav = h('div', 'hd-hero-nav');
    if (slides.length > 1) {
      slides.forEach(function (_, i) {
        var b = h('button', 'hd-plank' + (i === 0 ? ' is-active' : ''));
        b.type = 'button'; b.setAttribute('aria-label', 'Show slide ' + (i + 1));
        b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
        b.addEventListener('click', function () { go(i); restart(); });
        nav.appendChild(b);
      });
      hero.appendChild(nav);
      var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function restart() {
        clearInterval(timer);
        if (!reduced) timer = setInterval(function () {
          if (!paused && !document.hidden && hero.isConnected) go(idx + 1);
        }, 6500);
      }
      hero.addEventListener('pointerenter', function () { paused = true; });
      hero.addEventListener('pointerleave', function () { paused = false; });
      hero.addEventListener('focusin', function () { paused = true; });
      hero.addEventListener('focusout', function () { paused = false; });
      restart();
      cleanups.push(function () { clearInterval(timer); });
    }
    parent.appendChild(hero);
    return hero;
  }

  function productsForCat(cat, ctx) {
    return WS.productsForCategories(ctx, cat.categoryIds || []);
  }

  function categoryAction(cat, ctx) {
    return function () {
      if (cat.id != null && ctx.openWorldCategory) ctx.openWorldCategory(cat.id);
      else if (cat.slug && ctx.openCategory) ctx.openCategory(cat.slug);
    };
  }

  function renderCategories(parent, cats, ctx, products) {
    if (!cats || !cats.length) return null;
    var sec = h('section', 'hd-categories'); sec.id = 'hd-collections';
    var head = h('div', 'hd-section-head');
    var txt = h('div'); txt.appendChild(h('span', 'hd-eyebrow', 'Explore our collections'));
    txt.appendChild(h('h2', 'hd-display', 'Crafted for every space'));
    head.appendChild(txt); sec.appendChild(head);
    var grid = h('div', 'hd-category-grid');

    cats.forEach(function (cat) {
      var list = productsForCat(cat, ctx);
      var fallback = list.filter(function (p) { return !!imageOf(p); })[0];
      var image = cat.image_url || cat.gif_url || (fallback && imageOf(fallback)) || '';
      var gif = cat.image_url ? cat.gif_url : '';
      var cut = !!(fallback && image === processed(fallback));
      var b = h('button', 'hd-category-card' + (cut ? ' has-cutout' : ''));
      b.type = 'button'; b.setAttribute('data-hd-category', String(cat.id == null ? cat.slug : cat.id));
      var media = h('span', 'hd-category-media');
      if (image) addMedia(media, image, gif, cat.name, cut, false);
      else { var ph = h('span', 'hd-category-ph'); ph.innerHTML = ROOM; media.appendChild(ph); }
      b.appendChild(media);
      var label = h('span', 'hd-category-label');
      label.appendChild(h('strong', '', cat.name));
      label.appendChild(h('span', 'hd-round-arrow')); label.lastChild.innerHTML = ARROW;
      b.appendChild(label);
      b.addEventListener('click', categoryAction(cat, ctx));
      grid.appendChild(b);
    });
    sec.appendChild(grid); parent.appendChild(sec);
    return sec;
  }

  function vendorLine(p, ctx) {
    var vendors = ctx.vendors ? ctx.vendors() : {};
    var vendor = p.vendor_id != null && vendors ? vendors[p.vendor_id] : null;
    var seller = vendor ? vendor.business_name : (ctx.storeName ? ctx.storeName() : '');
    var pieces = [];
    if (p.brand) pieces.push(p.brand);
    if (seller) pieces.push(seller);
    if (!pieces.length) return null;
    var line = h(vendor && ctx.openStore ? 'button' : 'div', 'hd-product-by', pieces.join(' · '));
    if (vendor && ctx.openStore) {
      line.type = 'button';
      line.addEventListener('click', function (e) { e.stopPropagation(); ctx.openStore(vendor.store_slug || vendor.id); });
    }
    return line;
  }

  function cardWrap(p, ctx, compact, cls) {
    var wrap = h('div', (cls || '') + (processed(p) ? ' has-cutout' : ''));
    wrap.setAttribute('data-home-product', String(p.id));
    wrap.innerHTML = ctx.cardHTML(display(p), compact ? { compact: true } : undefined);
    var by = vendorLine(p, ctx); if (by) wrap.appendChild(by);
    return wrap;
  }

  function renderFeatured(parent, products, ctx) {
    if (!products.length) return null;
    var curated = products.filter(function (p) { return !!p.featured; });
    var title = 'Our most loved pieces';
    if (!curated.length) { curated = products.slice(0, 4); title = 'New for your space'; }
    else curated = curated.slice(0, 4);

    var sec = h('section', 'hd-featured');
    var head = h('div', 'hd-section-head');
    var txt = h('div'); txt.appendChild(h('span', 'hd-eyebrow', curated[0] && curated[0].featured ? 'Featured' : 'Recently added'));
    txt.appendChild(h('h2', 'hd-display', title)); head.appendChild(txt); sec.appendChild(head);
    var grid = h('div', 'hd-featured-grid');
    curated.forEach(function (p) { grid.appendChild(cardWrap(p, ctx, true, 'hd-featured-card')); });
    sec.appendChild(grid); parent.appendChild(sec);
    return sec;
  }

  function fallbackGroups(products, ctx) {
    var tree = ctx.tree && ctx.tree(), map = {}, out = [];
    if (!tree) return [];
    products.forEach(function (p) {
      var cat = p.category_id != null ? tree.byId[p.category_id] : null;
      if (!cat) return;
      var key = String(cat.id);
      if (!map[key]) {
        map[key] = { id: null, slug: cat.slug, name: cat.name, categoryIds: [cat.id], _fallback: true };
        out.push(map[key]);
      }
    });
    return out;
  }

  function renderCollectionRail(parent, group, products, ctx) {
    if (!products.length) return null;
    var sec = h('section', 'hd-collection');
    sec.setAttribute('data-hd-rail', '');
    var sticky = h('div', 'hd-collection-sticky');
    var head = h('div', 'hd-rail-head');
    var title = h('div'); title.appendChild(h('span', 'hd-eyebrow', 'Collection'));
    title.appendChild(h('h2', 'hd-rail-title', group.name));
    head.appendChild(title); head.appendChild(h('span', 'hd-rail-hint', 'Scroll to explore'));
    sticky.appendChild(head);

    var viewport = h('div', 'hd-rail-viewport');
    var track = h('div', 'hd-rail-track');
    products.slice(0, 8).forEach(function (p) { track.appendChild(cardWrap(p, ctx, true, 'hd-rail-card')); });
    var more = h('button', 'hd-rail-more'); more.type = 'button';
    more.appendChild(h('span', 'hd-eyebrow', 'View collection'));
    var icon = h('span', 'hd-more-icon'); icon.innerHTML = ARROW; more.appendChild(icon);
    more.addEventListener('click', categoryAction(group, ctx));
    track.appendChild(more); viewport.appendChild(track); sticky.appendChild(viewport);
    var meter = h('div', 'hd-rail-meter'); meter.appendChild(h('span')); sticky.appendChild(meter);
    sec.appendChild(sticky); parent.appendChild(sec);
    return sec;
  }

  /* This is the Wood CollectionRail interaction translated from React/window
     scrolling to Marcato's existing full-screen world scroller. Vertical travel
     moves the furniture cards horizontally; reduced-motion and tiny rails fall
     back to a native swipeable scroll-snap row. */
  function setupRails(page, cleanups) {
    var rails = Array.prototype.slice.call(page.querySelectorAll('[data-hd-rail]'));
    if (!rails.length) return;
    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var raf = 0;

    function measure() {
      rails.forEach(function (sec) {
        var view = sec.querySelector('.hd-rail-viewport'), track = sec.querySelector('.hd-rail-track');
        var budget = Math.max(0, (track.scrollWidth || 0) - (view.clientWidth || 0));
        sec._hdBudget = budget;
        var free = reduced || budget < 60;
        sec.classList.toggle('is-free', free);
        sec.style.height = free ? 'auto' : 'calc(100dvh + ' + Math.ceil(budget) + 'px)';
        if (free) { track.style.transform = ''; sec.querySelector('.hd-rail-meter span').style.width = '100%'; }
      });
      paint();
    }
    function paint() {
      raf = 0;
      var rootRect = page.getBoundingClientRect ? page.getBoundingClientRect() : { top: 0 };
      rails.forEach(function (sec) {
        if (sec.classList.contains('is-free') || !sec._hdBudget) return;
        var rect = sec.getBoundingClientRect();
        var distance = Math.max(0, Math.min(sec._hdBudget, (rootRect.top + 52) - rect.top));
        var progress = sec._hdBudget ? distance / sec._hdBudget : 0;
        sec.querySelector('.hd-rail-track').style.transform = 'translate3d(-' + distance + 'px,0,0)';
        sec.querySelector('.hd-rail-meter span').style.width = Math.max(3, progress * 100) + '%';
        sec.querySelector('.hd-rail-hint').classList.toggle('is-hidden', progress > 0.04);
      });
    }
    function onScroll() {
      if (!raf) raf = (global.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(paint);
    }
    page.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', measure);
    var ro = global.ResizeObserver ? new ResizeObserver(measure) : null;
    if (ro) rails.forEach(function (r) { ro.observe(r.querySelector('.hd-rail-track')); });
    setTimeout(measure, 0);
    cleanups.push(function () {
      page.removeEventListener('scroll', onScroll);
      global.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
      if (raf && global.cancelAnimationFrame) global.cancelAnimationFrame(raf);
    });
  }

  function renderAllGrid(parent, products, ctx) {
    var sec = h('section', 'hd-all');
    var head = h('div', 'hd-section-head');
    var txt = h('div'); txt.appendChild(h('span', 'hd-eyebrow', 'The full collection'));
    txt.appendChild(h('h2', 'hd-display', products.length ? 'Everything for home' : 'More for home, soon'));
    head.appendChild(txt); sec.appendChild(head);
    if (!products.length) {
      var empty = h('div', 'hd-empty'); empty.innerHTML = ROOM;
      empty.appendChild(h('h3', '', 'No Home & Decor products yet'));
      empty.appendChild(h('p', '', 'When eligible products are added to the linked categories, they will appear here automatically.'));
      sec.appendChild(empty);
    } else {
      var grid = h('div', 'hd-product-grid');
      products.forEach(function (p) { grid.appendChild(cardWrap(p, ctx, false, 'hd-grid-card')); });
      sec.appendChild(grid);
    }
    parent.appendChild(sec);
  }

  function mount(parent, world, config, ctx) {
    var page = parent.closest ? parent.closest('#worldPage') : parent.parentNode;
    var cleanups = [];
    if (page && page._homeDecorCleanup) page._homeDecorCleanup();
    if (page) page._homeDecorCleanup = function () {
      cleanups.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
    };

    parent.classList.add('hd-world');
    var products = WS.worldProducts(ctx, world, config || {});
    var cats = (config && config.cats) || [];

    renderHero(parent, (config && config.heroes) || [], products, ctx, cleanups);

    var intro = h('section', 'hd-intro');
    intro.appendChild(h('span', 'hd-eyebrow', 'Marcato living'));
    intro.appendChild(h('h2', 'hd-intro-title', 'A considered home, piece by piece.'));
    intro.appendChild(h('p', '', 'Discover furniture and finishing touches from independent Marcato sellers, selected for every room and every way of living.'));
    parent.appendChild(intro);

    renderCategories(parent, cats, ctx, products);
    renderFeatured(parent, products, ctx);

    var groups = cats.length ? cats : fallbackGroups(products, ctx);
    groups.forEach(function (cat) {
      var list = productsForCat(cat, ctx).filter(function (p) { return products.indexOf(p) !== -1; });
      renderCollectionRail(parent, cat, list, ctx);
    });
    renderAllGrid(parent, products, ctx);
    if (page) setupRails(page, cleanups);

    return { products: products, destroy: page && page._homeDecorCleanup };
  }

  Pcx.HomeDecorWorld = { mount: mount, productHeroSlides: productHeroSlides, fallbackGroups: fallbackGroups };
  Pcx.WorldExtensions = Pcx.WorldExtensions || {};
  Pcx.WorldExtensions.home = mount;
  Pcx.WorldExtensions['home-decor'] = mount;
})(window);
