/* Admin: category manager (main categories, subcategories, any depth).
 *
 * Talks to the `categories` table (see data/categories.js for the columns). Everything is editable here:
 * add, edit, hide (is_active), delete, reorder (up/down), change the thumbnail, add a subcategory, and move a
 * category under a different parent. "Bulk thumbnails" uploads many images at once, matching each file name to a slug
 * (fashion-clothing.png -> Fashion & Clothing), and "Export list" downloads name/slug/parent so you know the names to use.
 *
 * Uses globals from admin/index.html: sb, toast, confirm, showLoad, hideLoad, uploadImage.
 * Needs: data/categories.js, components/category-picker.js, components/categories.css, admin/categories.css.
 * After every load it fires a `categories:loaded` event on document (detail = tree) so the product form can refresh its picker.
 */
(function () {
  'use strict';

  var C = Pcx.Categories, esc = C.esc;
  var rows = [], tree = null, expanded = {}, query = '', editing = null, loadError = '';
  var parentPicker = null, pendingFile = null, removeImage = false;

  var root = function () { return document.getElementById('catAdmin'); };
  var $ = function (id) { return document.getElementById(id); };
  var GAP = 10;

  /* ------------------------------------------------------------------ load */
  async function load() {
    C.init(sb);
    var r = await C.fetchAll(sb, { includeInactive: true });
    loadError = r.error ? r.error.message : '';
    rows = r.rows;
    rebuild();
    render();
  }

  function rebuild() {
    tree = new C.Tree(rows);
    document.dispatchEvent(new CustomEvent('categories:loaded', { detail: tree }));
  }

  /* ------------------------------------------------------------------ list */
  function siblingsOf(c) { return c.parentId == null ? tree.roots : tree.children(c.parentId); }

  function rowHTML(c, depth, showPath) {
    var kids = tree.children(c.id).length;
    var sibs = siblingsOf(c), idx = sibs.indexOf(c);
    var meta = [];
    if (showPath) meta.push(tree.label(c.id));
    if (kids) meta.push(kids + ' sub' + (kids === 1 ? '' : 's'));
    meta.push(c.slug);
    var chev = kids && !showPath
      ? '<button type="button" class="cat-chev" data-act="tog" data-id="' + c.id + '" aria-label="Show subcategories">' + (expanded[c.id] ? '\u25be' : '\u25b8') + '</button>'
      : '<span class="cat-chev none"></span>';
    return '<div class="cat-row' + (c.active ? '' : ' off') + '" style="margin-left:' + (showPath ? 0 : depth * 16) + 'px">' +
      chev + C.thumb(tree, c, 's40') +
      '<div class="cat-main"><div class="cat-name">' + esc(c.name) + (c.active ? '' : '<span class="pill">hidden</span>') + '</div>' +
      '<div class="cat-meta">' + esc(meta.join(' \u00b7 ')) + '</div></div>' +
      '<div class="cat-acts">' +
        (showPath ? '' : '<button type="button" data-act="up" data-id="' + c.id + '"' + (idx <= 0 ? ' disabled' : '') + ' aria-label="Move up">\u2191</button>' +
                         '<button type="button" data-act="down" data-id="' + c.id + '"' + (idx >= sibs.length - 1 ? ' disabled' : '') + ' aria-label="Move down">\u2193</button>') +
        '<button type="button" data-act="sub" data-id="' + c.id + '" aria-label="Add subcategory">+</button>' +
        '<button type="button" data-act="edit" data-id="' + c.id + '">Edit</button>' +
      '</div></div>';
  }

  function listHTML() {
    if (!tree.list.length) return '<div class="no-items"><h3>No categories yet</h3><p>Run the categories SQL in Supabase to load the starter catalog, or add one above.</p></div>';
    var q = query.trim().toLowerCase();
    if (q) {
      var hits = tree.list.filter(function (c) { return c.name.toLowerCase().indexOf(q) >= 0 || c.slug.indexOf(q) >= 0; });
      if (!hits.length) return '<div class="no-items"><h3>No match</h3></div>';
      return hits.slice(0, 100).map(function (c) { return rowHTML(c, 0, true); }).join('') +
        (hits.length > 100 ? '<div class="cat-note">Showing 100 of ' + hits.length + '. Type more to narrow it down.</div>' : '');
    }
    var out = [];
    (function walk(list, depth) {
      list.forEach(function (c) {
        out.push(rowHTML(c, depth, false));
        if (expanded[c.id]) walk(tree.children(c.id), depth + 1);
      });
    })(tree.roots, 0);
    return out.join('');
  }

  function render() {
    var el = root();
    if (!el) return;
    el.innerHTML =
      (loadError ? '<div class="cat-err">Could not load categories: ' + esc(loadError) + '<br>If the table does not exist yet, run the categories SQL in the Supabase SQL editor.</div>' : '') +
      '<div class="fcard" id="catHead"><h3>Categories <span class="pill">' + tree.list.length + '</span></h3>' +
        '<div class="cat-bar">' +
          '<button type="button" class="abtn solid" data-act="add">+ Main category</button>' +
          '<label class="abtn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">Bulk thumbnails<input id="catBulk" type="file" accept="image/*" multiple style="display:none"></label>' +
          '<button type="button" class="abtn" data-act="export">Export list</button>' +
        '</div>' +
        '<div class="cat-note">Tap \u25b8 to open a category, \u2191\u2193 to reorder, + to add a subcategory. Hidden categories disappear from the store but keep their products. Bulk thumbnails: name each file after the category slug, e.g. <b>fashion-clothing.png</b>.</div>' +
      '</div>' +
      '<div id="catFormSlot"></div>' +
      '<input class="cat-search" id="catSearch" type="search" placeholder="Search ' + tree.list.length + ' categories" value="' + esc(query) + '">' +
      '<div id="catList">' + listHTML() + '</div>';
    if (editing) renderForm();
  }

  function renderList() { var l = $('catList'); if (l) l.innerHTML = listHTML(); }

  /* ------------------------------------------------------------------ form */
  function openForm(state) { editing = state; pendingFile = null; removeImage = false; render(); $('catFormSlot').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function closeForm() { editing = null; pendingFile = null; removeImage = false; var s = $('catFormSlot'); if (s) s.innerHTML = ''; }

  function renderForm() {
    var e = editing, c = e.id ? tree.byId[e.id] : null;
    var slot = $('catFormSlot');
    var previewCat = c || { id: -1, name: e.name || '?', icon: e.icon || '', color: e.color || '', imageUrl: '', placeholderPath: '' };
    slot.innerHTML =
      '<div class="fcard" id="catForm"><h3>' + (c ? 'Edit category' : (e.parentId != null ? 'New subcategory' : 'New main category')) + '</h3>' +
      '<div class="fg"><label>Name *</label><input id="cfName" type="text" maxlength="80" placeholder="e.g. Men\'s Clothing" value="' + esc(e.name || '') + '"></div>' +
      '<div class="fg"><label>Slug (unique, used in links and thumbnail file names)</label><input id="cfSlug" type="text" maxlength="90" placeholder="auto from name" value="' + esc(e.slug || '') + '"></div>' +
      '<div class="fg"><label>Parent</label><div id="cfParent"></div><div class="ad-hint">Leave empty for a main category. To move this category, pick a different parent.</div></div>' +
      '<div class="row2">' +
        '<div class="fg"><label>Icon (emoji, optional)</label><input id="cfIcon" type="text" maxlength="4" placeholder="\ud83d\udc55" value="' + esc(e.icon || '') + '"></div>' +
        '<div class="fg"><label>Tile colour</label><div class="cat-colorrow"><input id="cfColor" type="color" value="' + esc(e.color || '#f0efeb') + '"><button type="button" class="btn-e" data-act="colorclear">Auto</button></div></div>' +
      '</div>' +
      '<div class="fg"><label>Thumbnail</label><div class="cat-imgrow"><div id="cfPrev" style="width:64px;flex-shrink:0">' + C.thumb(tree, previewCat, 's56') + '</div>' +
        '<div class="cat-imgbtns"><input id="cfFile" type="file" accept="image/*"><button type="button" class="btn-e" data-act="rmimg">Remove image</button></div></div>' +
        '<div class="ad-hint">No image? The icon on the tile colour is shown instead, so nothing looks broken.</div></div>' +
      '<label class="cat-chk"><input id="cfActive" type="checkbox"' + (e.active === false ? '' : ' checked') + '> Visible in the store</label>' +
      '<div class="form-btns"><button type="button" class="btn-p" data-act="save">' + (c ? 'Save changes' : 'Add category') + '</button>' +
        '<button type="button" class="btn-s" data-act="cancel">Cancel</button>' +
        (c ? '<button type="button" class="btn-d" data-act="del">Delete</button>' : '') + '</div></div>';

    parentPicker = new Pcx.CategoryPicker($('cfParent'), {
      tree: tree, includeInactive: true, exclude: c ? c.id : null,
      placeholder: 'None (main category)', subPlaceholder: 'Inside... (optional)'
    });
    parentPicker.setValue(e.parentId);
    $('cfFile').addEventListener('change', function () {
      pendingFile = this.files[0] || null; removeImage = false;
      if (pendingFile) $('cfPrev').innerHTML = '<div class="cat-thumb s56"><img src="' + URL.createObjectURL(pendingFile) + '" alt=""></div>';
    });
    $('cfName').addEventListener('input', function () {   // slug follows the name until it is edited by hand or already saved
      if (!editing.id && !editing.slugTouched) $('cfSlug').value = C.slugify(this.value);
    });
    $('cfSlug').addEventListener('input', function () { editing.slugTouched = true; });
  }

  function readForm() {
    return {
      name: $('cfName').value.trim(),
      slug: C.slugify($('cfSlug').value || $('cfName').value),
      parentId: parentPicker.getValue(),
      icon: $('cfIcon').value.trim() || null,
      color: editing.colorCleared ? null : ($('cfColor').value === '#f0efeb' && !editing.color ? null : $('cfColor').value),
      active: $('cfActive').checked
    };
  }

  async function save() {
    var f = readForm(), c = editing.id ? tree.byId[editing.id] : null;
    if (!f.name) return toast('Name is required', true);
    if (!f.slug) return toast('Slug is required', true);
    if (tree.list.some(function (x) { return x.slug === f.slug && (!c || x.id !== c.id); })) return toast('That slug is already used', true);
    if (c && f.parentId != null && tree.descendantIds(c.id).indexOf(f.parentId) >= 0) return toast('A category cannot go inside itself', true);

    showLoad('Saving...');
    try {
      var image_url = c ? (c.imageUrl || null) : null;
      if (removeImage) image_url = null;
      if (pendingFile) image_url = await uploadThumb(pendingFile);

      var row = { name: f.name, slug: f.slug, parent_id: f.parentId, icon: f.icon, color: f.color, image_url: image_url, is_active: f.active };
      var parentChanged = !c || (c.parentId == null ? null : c.parentId) !== (f.parentId == null ? null : f.parentId);
      if (parentChanged) {                                 // new, or moved: put it last among its new siblings
        var sibs = f.parentId == null ? tree.roots : tree.children(f.parentId);
        row.sort_order = sibs.reduce(function (m, s) { return Math.max(m, s.sortOrder); }, 0) + GAP;
        if (!c) row.placeholder_path = C.PH_DIR + '/' + f.slug + '.png';
      } else if (c && c.slug !== f.slug && c.placeholderPath === C.PH_DIR + '/' + c.slug + '.png') {
        row.placeholder_path = C.PH_DIR + '/' + f.slug + '.png';   // keep the placeholder convention in step with the slug
      }

      var res = c ? await sb.from('categories').update(row).eq('id', c.id) : await sb.from('categories').insert([row]);
      if (res.error) throw res.error;
      toast(c ? 'Category updated' : 'Category added');
      if (f.parentId != null) expanded[f.parentId] = true;
      closeForm();
      await load();
    } catch (e) {
      toast(explain(e), true);
    } finally { hideLoad(); }
  }

  async function remove() {
    var c = tree.byId[editing.id];
    if (!c) return;
    if (tree.children(c.id).length) return toast('Move or delete its subcategories first', true);
    var cnt = await sb.from('products').select('id', { count: 'exact', head: true }).eq('category_id', c.id);
    var n = cnt.count || 0;
    confirm('Delete category', n
      ? n + ' product' + (n === 1 ? ' uses' : 's use') + ' "' + c.name + '". They will stay in the store but lose this category. Hiding it instead keeps them. Delete anyway?'
      : 'Delete "' + c.name + '"?', async function () {
      showLoad('Deleting...');
      var r = await sb.from('categories').delete().eq('id', c.id);
      hideLoad();
      if (r.error) return toast(explain(r.error), true);
      toast('Category deleted');
      closeForm();
      await load();
    });
  }

  /* ------------------------------------------------------------------ reorder */
  async function move(id, dir) {
    var c = tree.byId[id], sibs = siblingsOf(c).slice(), i = sibs.indexOf(c), j = i + dir;
    if (i < 0 || j < 0 || j >= sibs.length) return;
    var t = sibs[i]; sibs[i] = sibs[j]; sibs[j] = t;
    var changes = [];
    sibs.forEach(function (s, k) {                          // rewrite as 10, 20, 30 ... so ties never stick
      var want = (k + 1) * GAP;
      if (s.sortOrder !== want) changes.push({ id: s.id, sort_order: want });
    });
    changes.forEach(function (ch) { rows.forEach(function (r) { if (r.id === ch.id) r.sort_order = ch.sort_order; }); });
    rebuild(); renderList();
    var results = await Promise.all(changes.map(function (ch) { return sb.from('categories').update({ sort_order: ch.sort_order }).eq('id', ch.id); }));
    var bad = results.filter(function (r) { return r.error; })[0];
    if (bad) { toast(explain(bad.error), true); await load(); }
  }

  /* ------------------------------------------------------------------ images */
  async function uploadThumb(file) {
    var keepAlpha = /png|webp|gif/.test(file.type);          // keep transparency; JPEG would turn it black
    return uploadImage(file, 'categories', null, null, keepAlpha);
  }

  async function bulkUpload(files) {
    var bySlug = {}, done = 0, missed = [];
    tree.list.forEach(function (c) { bySlug[c.slug] = c; });
    showLoad('Uploading thumbnails...');
    try {
      for (var i = 0; i < files.length; i++) {
        var f = files[i], slug = C.slugify(f.name.replace(/\.[^.]+$/, ''));
        var c = bySlug[slug];
        if (!c) { missed.push(f.name); continue; }
        showLoad('Uploading ' + (i + 1) + ' of ' + files.length + '...');
        var url = await uploadThumb(f);
        var r = await sb.from('categories').update({ image_url: url }).eq('id', c.id);
        if (r.error) throw r.error;
        done++;
      }
    } catch (e) { toast(explain(e), true); }
    hideLoad();
    toast(done + ' thumbnail' + (done === 1 ? '' : 's') + ' uploaded' + (missed.length ? '. No category for: ' + missed.slice(0, 4).join(', ') + (missed.length > 4 ? ' +' + (missed.length - 4) + ' more' : '') : ''), missed.length > 0 && !done);
    await load();
  }

  function exportCSV() {
    var q = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; };
    var lines = ['name,slug,parent_slug,visible,has_image'];
    tree.list.forEach(function (c) {
      var p = c.parentId != null ? tree.byId[c.parentId] : null;
      lines.push([q(c.name), q(c.slug), q(p ? p.slug : ''), c.active ? 'yes' : 'no', c.imageUrl ? 'yes' : 'no'].join(','));
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'categories.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function explain(e) {
    var m = (e && e.message) || String(e);
    if (/duplicate key|unique/i.test(m)) return 'That slug is already used';
    if (/row-level security|policy|permission denied/i.test(m)) return 'Not allowed. Sign in with the admin Google account (and make sure the categories SQL has been run).';
    if (/relation .*categories.* does not exist|schema cache/i.test(m)) return 'The categories table is missing. Run the categories SQL in Supabase.';
    if (/cycle/i.test(m)) return 'A category cannot go inside itself or one of its own subcategories';
    return 'Save failed: ' + m;
  }

  /* ------------------------------------------------------------------ events */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('#catAdmin [data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id') ? Number(b.getAttribute('data-id')) : null;
    if (act === 'tog') { expanded[id] = !expanded[id]; renderList(); }
    else if (act === 'up') move(id, -1);
    else if (act === 'down') move(id, 1);
    else if (act === 'add') openForm({ id: null, parentId: null, active: true });
    else if (act === 'sub') { expanded[id] = true; openForm({ id: null, parentId: id, active: true }); }
    else if (act === 'edit') { var c = tree.byId[id]; openForm({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, icon: c.icon, color: c.color, active: c.active }); }
    else if (act === 'save') save();
    else if (act === 'cancel') closeForm();
    else if (act === 'del') remove();
    else if (act === 'rmimg') { removeImage = true; pendingFile = null; $('cfFile').value = ''; var c2 = editing.id ? tree.byId[editing.id] : null;
      $('cfPrev').innerHTML = C.thumb(tree, c2 ? Object.assign({}, c2, { imageUrl: '', placeholderPath: '' }) : { id: -1, name: '?', icon: '', color: '', imageUrl: '', placeholderPath: '' }, 's56'); }
    else if (act === 'colorclear') { editing.colorCleared = true; $('cfColor').value = '#f0efeb'; }
    else if (act === 'export') exportCSV();
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'catSearch') { query = ev.target.value; renderList(); }
    if (ev.target.id === 'cfColor' && editing) editing.colorCleared = false;
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'catBulk' && ev.target.files.length) { var fl = Array.prototype.slice.call(ev.target.files); ev.target.value = ''; bulkUpload(fl); }
  });

  window.CatAdmin = { load: load, tree: function () { return tree; } };
})();
