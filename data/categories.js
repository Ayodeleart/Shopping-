/* Categories: data layer shared by the storefront, the vendor board and the admin panel.
 *
 * ONE table, `categories`, holds the whole catalog (main categories and any depth of subcategories):
 *   id, parent_id, slug (unique), name, description, icon (emoji, optional), color (tile background),
 *   image_url (uploaded thumbnail), placeholder_path (storage path tried when image_url is empty),
 *   sort_order, is_active.
 * Products point at it with products.category_id; products.category keeps the leaf name as text.
 *
 *   Pcx.Categories.init(sb);                                 // once, gives the module the Supabase client
 *   const { rows, error } = await Pcx.Categories.fetchAll(sb);      // active only; { includeInactive:true } for admin
 *   const tree = new Pcx.Categories.Tree(rows);
 *   tree.visibleRoots(), tree.visibleChildren(id), tree.path(id), tree.descendantIds(id) ...
 *   Pcx.Categories.thumb(tree, cat)                          // HTML for a thumbnail tile (image, else emoji on colour)
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  var BUCKET = 'avatars';
  var PH_DIR = 'category-placeholders';   // storage folder for placeholder thumbnails named <slug>.png
  var FALLBACK_COLOR = '#F0EFEB';
  var sbClient = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* same rule as the SQL seed, so slugs typed in the admin look like the seeded ones */
  function slugify(name) {
    return String(name || '').toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function norm(r) {
    return {
      id: r.id,
      parentId: r.parent_id == null ? null : r.parent_id,
      slug: r.slug,
      name: r.name,
      description: r.description || '',
      icon: r.icon || '',
      color: r.color || '',
      imageUrl: r.image_url || '',
      placeholderPath: r.placeholder_path || '',
      sortOrder: r.sort_order || 0,
      active: r.is_active !== false
    };
  }

  function byOrder(a, b) {
    return (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name));
  }

  /* ---------------------------------------------------------------- Tree */
  function Tree(rows) {
    this.list = (rows || []).map(norm).sort(byOrder);
    this.byId = {};
    this.bySlug = {};
    this.kids = {};
    var self = this;
    this.list.forEach(function (c) { self.byId[c.id] = c; self.bySlug[c.slug] = c; });
    this.list.forEach(function (c) {
      var k = c.parentId != null && self.byId[c.parentId] ? c.parentId : 'root';   // orphan rows are treated as main categories
      (self.kids[k] = self.kids[k] || []).push(c);
    });
    this.roots = this.kids.root || [];
  }
  var T = Tree.prototype;

  T.children = function (id) { return this.kids[id] || []; };

  T.path = function (id) {                    // main category first, the category itself last
    var out = [], c = this.byId[id], guard = 0;
    while (c && guard++ < 20) { out.unshift(c); c = c.parentId != null ? this.byId[c.parentId] : null; }
    return out;
  };

  T.descendantIds = function (id) {           // includes id itself
    var out = [], stack = [id], seen = {};
    while (stack.length) {
      var x = stack.pop();
      if (seen[x]) continue;
      seen[x] = 1; out.push(x);
      this.children(x).forEach(function (c) { stack.push(c.id); });
    }
    return out;
  };

  T.isVisible = function (id) {               // active itself and every parent active
    return this.path(id).every(function (c) { return c.active; }) && !!this.byId[id];
  };

  T.visibleRoots = function () { return this.roots.filter(function (c) { return c.active; }); };
  T.visibleChildren = function (id) { return this.children(id).filter(function (c) { return c.active; }); };

  T.rootOf = function (id) { var p = this.path(id); return p.length ? p[0] : null; };
  T.label = function (id, sep) { return this.path(id).map(function (c) { return c.name; }).join(sep || ' \u203a '); };

  T.color = function (cat) {                  // own colour, else nearest parent's, else neutral
    var p = this.path(cat.id);
    for (var i = p.length - 1; i >= 0; i--) if (p[i].color) return p[i].color;
    return FALLBACK_COLOR;
  };
  T.icon = function (cat) {
    var p = this.path(cat.id);
    for (var i = p.length - 1; i >= 0; i--) if (p[i].icon) return p[i].icon;
    return '';
  };

  /* Does this product belong to category `id` (or anything under it)?
     Products saved before categories existed only have the text name, so they match on that as a fallback. */
  T.productMatcher = function (id) {
    var ids = {}, names = {}, self = this;
    this.descendantIds(id).forEach(function (x) { ids[x] = 1; names[String(self.byId[x].name).trim().toLowerCase()] = 1; });
    return function (p) {
      if (p.category_id != null) return !!ids[p.category_id];
      return !!p.category && !!names[String(p.category).trim().toLowerCase()];
    };
  };

  /* ---------------------------------------------------------------- data */
  async function fetchAll(sb, opts) {
    var rows = [], from = 0, page = 1000;
    for (;;) {
      var q = sb.from('categories').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }).range(from, from + page - 1);
      if (!opts || !opts.includeInactive) q = q.eq('is_active', true);
      var r = await q;
      if (r.error) return { rows: [], error: r.error };
      rows = rows.concat(r.data || []);
      if (!r.data || r.data.length < page) break;
      from += page;
    }
    return { rows: rows, error: null };
  }

  /* ---------------------------------------------------------------- thumbnails */
  function imageUrl(cat) {
    if (cat.imageUrl) return cat.imageUrl;
    if (cat.placeholderPath && sbClient) return sbClient.storage.from(BUCKET).getPublicUrl(cat.placeholderPath).data.publicUrl;
    return '';
  }

  /* Emoji (or first letter) on the category colour sits underneath; the image, when there is one, covers it.
     If the image 404s (placeholder not uploaded yet) it removes itself and the emoji tile shows. */
  function thumb(tree, cat, cls) {
    var url = imageUrl(cat);
    var ph = tree.icon(cat) || String(cat.name || '?').charAt(0).toUpperCase();
    return '<div class="cat-thumb ' + (cls || '') + '" style="background:' + esc(tree.color(cat)) + '">' +
      '<span class="cat-thumb-ph">' + esc(ph) + '</span>' +
      (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
      '</div>';
  }

  Pcx.Categories = {
    BUCKET: BUCKET,
    PH_DIR: PH_DIR,
    init: function (sb) { sbClient = sb; },
    fetchAll: fetchAll,
    Tree: Tree,
    slugify: slugify,
    esc: esc,
    imageUrl: imageUrl,
    thumb: thumb
  };
})(window);
