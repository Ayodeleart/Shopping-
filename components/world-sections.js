/* Pcx.WorldSections
 * The generic building blocks of an Explore Marcato world. The SAME code renders Food, Fashion, Beauty, Home,
 * Gifts and any world the admin adds later; nothing here knows a world's name.
 *
 *   Explore world (worlds)
 *     -> hero slides              (world_heroes)
 *     -> display categories       (world_display_categories)  the visual cards inside the world, 5 per row on mobile
 *          -> linked categories   (world_category_links)      point at the NORMAL marketplace categories
 *               -> real products  (products.category_id, via Pcx.Categories.Tree.productMatcher: a category
 *                                  also matches everything under it)
 *
 * Display categories are world content, not marketplace taxonomy. The normal `categories` table is only read.
 *
 * The page hands this module a `ctx` (a bag of getters, so nothing depends on globals):
 *   ctx = { sb, tree: () => Pcx.Categories.Tree|null, products: () => [...], cardHTML: p => html,
 *           openCategory: slug => {}, openWorldCategory: id => {}, onBack: () => {} }
 *
 *   await Pcx.WorldSections.load(sb, slug)          -> { heroes, cats:[{id,name,image_url,gif_url,categoryIds}], error, missing }
 *   Pcx.WorldSections.loadCategory(sb, id)          -> { cat, worldSlug, worldName, categoryIds } | null
 *   Pcx.WorldSections.renderHero(parent, heroes, ctx)
 *   Pcx.WorldSections.renderDisplayCategories(parent, cats, ctx)
 *   Pcx.WorldSections.productsForCategories(ctx, categoryIds)   -> products in any of those categories (or below them)
 *   Pcx.WorldSections.worldProducts(ctx, world, config)         -> every product reachable from the world
 *   Pcx.WorldSections.renderWorld(parent, world, config, ctx)   -> hero + display categories + products (generic worlds)
 *
 * Needs components/world-sections.css and data/safe.js.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  var TTL = 60 * 1000;      // a world's config is reused for a minute, so re-opening it is instant but admin edits show up quickly
  var cache = {};

  function safe(u) { return global.safeHref ? global.safeHref(u) : String(u || ''); }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------------------------------------------------------------- data */

  async function fetchConfig(sb, slug) {
    var out = { heroes: [], cats: [], error: '', missing: false };
    var r = await Promise.all([
      sb.from('world_heroes').select('*').eq('world_slug', slug).eq('is_active', true)
        .order('sort_order', { ascending: true }).order('id', { ascending: true }),
      sb.from('world_display_categories').select('*').eq('world_slug', slug).eq('is_active', true)
        .order('sort_order', { ascending: true }).order('id', { ascending: true })
    ]);
    var err = r[0].error || r[1].error;
    if (err) { out.error = err.message || String(err); out.missing = /relation|schema cache|does not exist|Could not find the table/i.test(out.error); return out; }

    out.heroes = r[0].data || [];
    var cats = r[1].data || [], links = [];
    if (cats.length) {
      var lr = await sb.from('world_category_links').select('display_category_id,category_id')
        .in('display_category_id', cats.map(function (c) { return c.id; }));
      if (lr.error) { out.error = lr.error.message || String(lr.error); return out; }
      links = lr.data || [];
    }
    var byCat = {};
    links.forEach(function (l) { (byCat[l.display_category_id] = byCat[l.display_category_id] || []).push(l.category_id); });
    out.cats = cats.map(function (c) {
      return { id: c.id, name: c.name, image_url: c.image_url || '', gif_url: c.gif_url || '', categoryIds: byCat[c.id] || [] };
    });
    return out;
  }

  async function load(sb, slug, force) {
    var c = cache[slug];
    if (!force && c && Date.now() - c.t < TTL) return c.v;
    var v = await fetchConfig(sb, slug);
    if (!v.error) cache[slug] = { t: Date.now(), v: v };
    return v;
  }

  function clearCache() { cache = {}; }

  /* one display category (the results page can be opened straight from a link, before any world page was) */
  async function loadCategory(sb, id) {
    var r = await sb.from('world_display_categories').select('*').eq('id', id).eq('is_active', true).maybeSingle();
    if (r.error || !r.data) return null;
    var cat = r.data;
    var wr = await sb.from('worlds').select('slug,title,is_active').eq('slug', cat.world_slug).maybeSingle();
    if (!wr.data || wr.data.is_active === false) return null;      // its world was removed or switched off
    var lr = await sb.from('world_category_links').select('category_id').eq('display_category_id', cat.id);
    if (lr.error) return null;
    return {
      cat: { id: cat.id, name: cat.name, image_url: cat.image_url || '', gif_url: cat.gif_url || '' },
      worldSlug: cat.world_slug,
      worldName: wr.data.title || cat.world_slug,
      categoryIds: (lr.data || []).map(function (l) { return l.category_id; })
    };
  }

  /* ---------------------------------------------------------------- products */

  /* Only categories that exist and are visible in the storefront tree count (hidden categories are not in it). */
  function matcherFor(tree, ids) {
    var ms = [], seen = {};
    (ids || []).forEach(function (id) {
      if (seen[id] || !tree || !tree.byId[id] || !tree.isVisible(id)) return;
      seen[id] = 1;
      ms.push(tree.productMatcher(id));
    });
    return function (p) {
      for (var i = 0; i < ms.length; i++) if (ms[i](p)) return true;
      return false;
    };
  }

  function productsForCategories(ctx, ids) {
    var tree = ctx.tree && ctx.tree();
    if (!tree || !ids || !ids.length) return [];
    return (ctx.products() || []).filter(matcherFor(tree, ids));
  }

  /* Every product reachable from a world: whatever its display categories point at, plus the normal category
     that has the same slug as the world (e.g. the Food category), if the store has one. */
  function worldProducts(ctx, world, config) {
    var tree = ctx.tree && ctx.tree();
    if (!tree) return [];
    var ids = [];
    ((config && config.cats) || []).forEach(function (c) { ids = ids.concat(c.categoryIds || []); });
    var same = world && tree.bySlug[world.slug];
    if (same) ids.push(same.id);
    return productsForCategories(ctx, ids);
  }

  /* ---------------------------------------------------------------- media (image + optional GIF on top) */

  function mediaInto(el, imageUrl, gifUrl) {
    var still = imageUrl || gifUrl;
    if (still) {
      var img = h('img', 'ws-m');
      img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', function () { img.remove(); });
      img.src = safe(still);
      el.appendChild(img);
    }
    if (imageUrl && gifUrl) {
      var gif = h('img', 'ws-m ws-gif');
      gif.alt = '';
      gif.addEventListener('load', function () { gif.classList.add('on'); });
      gif.addEventListener('error', function () { gif.remove(); });
      gif.src = safe(gifUrl);
      el.appendChild(gif);
    }
  }

  /* ---------------------------------------------------------------- hero */

  function ctaAction(hero, ctx) {
    var label = String(hero.cta_label || '').trim(), val = String(hero.cta_value || '').trim();
    if (!label || !val) return null;
    if (hero.cta_type === 'category') {
      var tree = ctx.tree && ctx.tree();
      if (!tree || !tree.bySlug[val]) return null;                 // the category was removed: no dead button
      return function () { ctx.openCategory(val); };
    }
    if (hero.cta_type === 'link') {
      if (/^#[a-z0-9=&_\-\/.]+$/i.test(val)) return function () { global.location.hash = val.slice(1); };
      var url = safe(val);
      if (url) return function () { global.location.href = url; };
    }
    return null;
  }

  function renderHero(parent, heroes, ctx) {
    if (!heroes || !heroes.length) return null;
    var wrap = h('section', 'ws-hero');
    var track = h('div', 'ws-hero-track');
    heroes.forEach(function (hs) {
      var slide = h('div', 'ws-slide');
      mediaInto(slide, hs.image_url, hs.gif_url);
      var act = ctaAction(hs, ctx);
      if (hs.title || hs.subtitle || act) {
        slide.classList.add('has-text');
        var txt = h('div', 'ws-slide-txt');
        if (hs.title) txt.appendChild(h('h2', 'ws-slide-ttl', hs.title));
        if (hs.subtitle) txt.appendChild(h('p', 'ws-slide-sub', hs.subtitle));
        if (act) {
          var b = h('button', 'ws-slide-cta', hs.cta_label); b.type = 'button';
          b.addEventListener('click', act);
          txt.appendChild(b);
        }
        slide.appendChild(txt);
      }
      track.appendChild(slide);
    });
    wrap.appendChild(track);

    var n = heroes.length;
    if (n > 1) {
      var dots = h('div', 'ws-dots'), idx = 0;
      for (var i = 0; i < n; i++) dots.appendChild(h('span', i === 0 ? 'on' : ''));
      wrap.appendChild(dots);
      var setDot = function (k) { idx = k; Array.prototype.forEach.call(dots.children, function (d, j) { d.classList.toggle('on', j === k); }); };
      var t;
      track.addEventListener('scroll', function () {
        clearTimeout(t);
        t = setTimeout(function () { if (track.clientWidth) setDot(Math.round(track.scrollLeft / track.clientWidth)); }, 80);
      });
      var still = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!still) {
        var timer = setInterval(function () {
          if (!wrap.isConnected) { clearInterval(timer); return; }      // the world page was rebuilt or closed
          if (document.hidden || !track.clientWidth) return;
          var next = (idx + 1) % n;
          track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
          setDot(next);
        }, 5000);
      }
    }
    parent.appendChild(wrap);
    return wrap;
  }

  /* ---------------------------------------------------------------- display categories */

  function renderDisplayCategories(parent, cats, ctx) {
    if (!cats || !cats.length) return null;
    var grid = h('div', 'ws-cats');
    cats.forEach(function (c) {
      var b = h('button', 'ws-cat'); b.type = 'button';
      b.setAttribute('data-wcat', String(c.id));
      var th = h('span', 'ws-cat-thumb');
      th.appendChild(h('span', 'ws-cat-ph', String(c.name || '?').charAt(0).toUpperCase()));
      mediaInto(th, c.image_url, c.gif_url);
      b.appendChild(th);
      b.appendChild(h('span', 'ws-cat-name', c.name));
      b.addEventListener('click', function () { ctx.openWorldCategory(c.id); });
      grid.appendChild(b);
    });
    parent.appendChild(grid);
    return grid;
  }

  /* ---------------------------------------------------------------- generic world */

  function productGrid(products, ctx) {
    var g = h('div', 'ws-grid3');
    g.innerHTML = products.map(function (p) { return '<div>' + ctx.cardHTML(p) + '</div>'; }).join('');
    return g;
  }

  function renderWorld(parent, world, config, ctx) {
    var hasHero = config.heroes && config.heroes.length, hasCats = config.cats && config.cats.length;
    var products = worldProducts(ctx, world, config);

    if (!hasHero && !hasCats && !products.length) {
      var body = h('div', 'wp-body');
      body.appendChild(h('span', 'wp-badge', 'Coming soon'));
      body.appendChild(h('p', 'wp-msg', 'We\u2019re building a dedicated ' + world.name + ' experience. For now, browse everything on the store.'));
      var cta = h('button', 'wp-cta', 'Continue shopping'); cta.type = 'button';
      cta.addEventListener('click', function () { ctx.onBack(); });
      body.appendChild(cta);
      parent.appendChild(body);
      return;
    }

    renderHero(parent, config.heroes, ctx);
    renderDisplayCategories(parent, config.cats, ctx);

    var sec = h('div', 'ws-sec');
    var hd = h('div', 'ws-sech'); hd.appendChild(h('span', 'ws-sech-ttl', products.length ? 'Shop ' + world.name : world.name));
    sec.appendChild(hd);
    if (products.length) sec.appendChild(productGrid(products, ctx));
    else sec.appendChild(h('div', 'ws-empty', 'No products here yet. Check back soon.'));
    parent.appendChild(sec);
  }

  Pcx.WorldSections = {
    load: load,
    clearCache: clearCache,
    loadCategory: loadCategory,
    matcherFor: matcherFor,
    productsForCategories: productsForCategories,
    worldProducts: worldProducts,
    renderHero: renderHero,
    renderDisplayCategories: renderDisplayCategories,
    renderWorld: renderWorld,
    productGrid: productGrid
  };
})(window);
