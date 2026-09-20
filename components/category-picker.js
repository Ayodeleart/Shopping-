/* Pcx.CategoryPicker
 * Cascading selects for the product forms: main category, then subcategory, then deeper levels if the tree has them.
 * A select is only shown while the chosen category still has active children, so a main category with no
 * subcategories is one select, and 600 subcategories never end up in one giant list.
 *
 *   const picker = new Pcx.CategoryPicker(el, { tree, onChange(id) {} });
 *   picker.setTree(tree);          // after (re)loading categories
 *   picker.setValue(id);           // e.g. when editing a product; no onChange fired
 *   picker.getValue();             // category id or null
 *   picker.names();                // [leaf name ... main name], handy for guessing a product type
 *   picker.label();                // "Fashion & Clothing > Men's Clothing"
 *   picker.clear();
 *
 * Options: emptyText (shown when there are no categories), placeholder (first select, default "Select a category"),
 * subPlaceholder (deeper selects), includeInactive (admin: list hidden categories too), exclude (category id whose
 * whole branch is left out, used when choosing a new parent so a category cannot be moved into itself).
 *
 * Needs data/categories.js (Pcx.Categories.Tree) and components/categories.css.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  function h(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') e.className = props[k];
      else if (k === 'text') e.textContent = props[k];
      else e.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }

  function CategoryPicker(root, opts) {
    this.root = root;
    this.o = Object.assign({ tree: null, onChange: null, emptyText: 'No categories yet.', placeholder: 'Select a category',
      subPlaceholder: 'Subcategory (optional)', includeInactive: false, exclude: null }, opts || {});
    this.id = null;
    this.render();
  }
  var P = CategoryPicker.prototype;

  P.setTree = function (tree) {
    this.o.tree = tree;
    if (this.id != null && !(tree && tree.byId[this.id])) this.id = null;
    this.render();
  };
  P.setValue = function (id) {
    var t = this.o.tree;
    this.id = id != null && t && t.byId[id] ? Number(id) : null;
    this.render();
  };
  P.clear = function () { this.id = null; this.render(); };
  P.getValue = function () { return this.id; };
  P.names = function () {
    var t = this.o.tree;
    return this.id != null && t ? t.path(this.id).map(function (c) { return c.name; }).reverse() : [];
  };
  P.label = function () { return this.id != null && this.o.tree ? this.o.tree.label(this.id, ' > ') : ''; };

  P.render = function () {
    var self = this, t = this.o.tree;
    this.root.textContent = '';
    this.root.classList.add('cp');
    if (!t || !t.list.length) { this.root.appendChild(h('div', { class: 'cp-note', text: this.o.emptyText })); return; }
    var all = this.o.includeInactive, skip = this.o.exclude;
    var list = function (parentId) {
      var l = parentId == null ? t.roots : t.children(parentId);
      return l.filter(function (c) { return (all || c.active) && c.id !== skip; });
    };

    var path = this.id != null ? t.path(this.id) : [];
    var parent = null, level = 0;
    for (;;) {
      var opts = list(parent ? parent.id : null);
      var sel = path[level] || null;
      if (!opts.length && !sel) break;
      if (sel && opts.indexOf(sel) < 0) opts = opts.concat([sel]);   // keep a since-hidden category selectable as-is

      (function (lvl, par, options, chosen) {
        var s = h('select', { 'aria-label': lvl ? 'Subcategory' : 'Category' });
        s.appendChild(h('option', { value: '', text: lvl ? self.o.subPlaceholder : self.o.placeholder }));
        options.forEach(function (c) {
          s.appendChild(h('option', { value: String(c.id), text: c.name + (c.active ? '' : ' (hidden)') }));
        });
        s.value = chosen ? String(chosen.id) : '';
        s.addEventListener('change', function () {
          self.id = s.value ? Number(s.value) : (par ? par.id : null);
          self.render();
          if (self.o.onChange) self.o.onChange(self.id);
        });
        self.root.appendChild(s);
      })(level, parent, opts, sel);

      if (!sel) break;
      parent = sel; level++;
    }
  };

  Pcx.CategoryPicker = CategoryPicker;
})(window);
