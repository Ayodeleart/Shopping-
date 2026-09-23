/* Admin: Beauty world manager (Banners > Beauty).
 *
 * Three things, all persisted in Supabase (migration_beauty.sql):
 *   1. Background  — the Beauty page background image (beauty_settings)
 *   2. Hero slides — beauty_heroes: image/GIF, title, subtitle, CTA, destination, order, live/paused
 *   3. Categories  — beauty_categories: the round Beauty tiles, each linked to a REAL
 *                    existing category (or honest keyword matching), with image/GIF, order, live/paused
 *
 * Nothing here is hard-coded as a source of truth: the seeded tile list is just
 * starting data the admin can rename, reorder, replace media on, enable/disable
 * or delete, and can add new tiles.
 *
 * Uses globals from admin/index.html: sb, toast, confirm, showLoad, hideLoad, uploadImage, safeUrl.
 * Needs: data/categories.js (Tree), data/beauty.js (slugify/kinds), components/category-picker.js,
 * components/multi-image-picker.js.
 */
(function () {
  'use strict';

  var B = Pcx.BeautyData;
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };
  var pane = function () { return document.getElementById('beautyPane'); };
  var state = { loaded: false, tableMissing: false, settings: {}, heroes: [], cats: [], cur: null, kind: null, catPicker: null, uploading: 0 };

  /* ── data ─────────────────────────────────────────────────────── */

  async function load() {
    var r = await Promise.all([
      sb.from('beauty_settings').select('*'),
      sb.from('beauty_heroes').select('*').order('sort_order', { ascending: true }),
      sb.from('beauty_categories').select('*').order('sort_order', { ascending: true })
    ]);
    state.tableMissing = !!(r[0].error || r[1].error || r[2].error);
    if (state.tableMissing) console.warn('Beauty tables missing — run migration_beauty.sql', r[0].error || r[1].error || r[2].error);
    var s = {};
    (r[0].data || []).forEach(function (row) { s[row.key] = row.value == null ? '' : String(row.value); });
    state.settings = s;
    state.heroes = r[1].data || [];
    state.cats = r[2].data || [];
    state.loaded = true;
  }

  function explain(m) {
    m = (m || '').toLowerCase();
    if (m.indexOf('does not exist') !== -1 || m.indexOf('schema cache') !== -1 || m.indexOf('relation') !== -1)
      return 'The Beauty tables are missing. Run the Beauty migration SQL in the Supabase SQL editor, then reopen this tab.';
    if (m.indexOf('row-level security') !== -1 || m.indexOf('policy') !== -1)
      return 'Blocked by row-level security. Run the Beauty migration SQL and sign in with the admin Google account.';
    return (m || 'save failed').replace(/^.*?message:\s*/i, '');
  }

  /* ── shared bits ──────────────────────────────────────────────── */

  function kindLabel(k) {
    return k === 'all' ? 'All products' : k === 'new' ? 'Newest' : k === 'best' ? 'Best sellers' : 'Category';
  }

  function itemShell(icon, title, meta, live, actions) {
    return '<div class="aditem">' +
      '<div class="aditem-img" style="overflow:hidden">' + icon + '</div>' +
      '<div class="aditem-body"><div class="aditem-name">' + title + '<span class="pill' + (live ? ' live' : '') + '">' + (live ? 'Live' : 'Paused') + '</span></div>' +
      '<div class="aditem-meta">' + meta + '</div></div>' +
      '<div class="aditem-acts">' + actions + '</div></div>';
  }

  function moveBtns(id, pos, total) {
    return (pos > 0 ? '<button class="abtn" data-a="up" data-id="' + esc(id) + '" title="Move up">\u2191</button>' : '') +
           (pos < total - 1 ? '<button class="abtn" data-a="down" data-id="' + esc(id) + '" title="Move down">\u2193</button>' : '');
  }

  /* re-sort two neighbouring rows like the categories manager does */
  async function reorder(table, list, idx) {
    var a = list[idx], b = list[idx + 1];
    if (!a || !b) return;
    var t = a.sort_order; a.sort_order = b.sort_order; b.sort_order = t;
    showLoad('Reordering...');
    var r = await Promise.all([
      sb.from(table).update({ sort_order: a.sort_order }).eq('id', a.id),
      sb.from(table).update({ sort_order: b.sort_order }).eq('id', b.id)
    ]);
    hideLoad();
    if (r.some(function (x) { return x.error; })) { toast('Reorder failed: ' + explain((r[0].error || r[1].error).message), true); return; }
    toast('Reordered');
    await load(); render();
  }

  function catLabel(id) {
    if (id == null) return 'Keyword match';
    if (typeof catTree !== 'undefined' && catTree) {
      var c = catTree.byId[id];
      if (c) return catTree.label(c.id);
    }
    return 'Category #' + id;
  }

  /* ── render ───────────────────────────────────────────────────── */

  function render() {
    if (state.cur) { renderForm(); return; }
    var h = '';

    h += '<div class="ph"><span class="pt">Beauty World</span></div>';
    if (state.tableMissing) h += '<div class="ad-empty">The Beauty tables are not set up yet. Run <b>the Beauty migration SQL</b> in the Supabase SQL editor, then reopen this tab.</div>';

    /* background */
    var bg = state.settings.background_url || '';
    var bgOn = state.settings.background_enabled !== '0';
    h += '<div class="fcard"><h3>Beauty Background</h3>' +
      '<div style="margin-bottom:12px">' +
        (bg
          ? '<img src="' + safeUrl(bg) + '" alt="" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;border:1px solid var(--border)">'
          : '<div style="height:110px;border-radius:12px;border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;color:var(--txt3);font-size:13px">No background yet — the world uses its built-in warm backdrop</div>') +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
        '<button class="btn-s" data-a="bg-upload">Upload / Replace</button>' +
        (bg ? '<button class="btn-s" data-a="bg-remove">Remove</button>' : '') +
        '<div class="tgl-row" style="margin-left:auto"><label>Background enabled</label><div class="tgl' + (bgOn ? ' on' : '') + '" data-tgl="bg"><div class="tgl-k"></div></div></div>' +
      '</div>' +
      '<div class="ad-hint" style="margin-top:8px">Shown behind the whole Beauty page (blurred, so product photos stay readable). JPG, PNG, WebP or GIF.</div>' +
      '<input type="file" id="bwBgFile" accept="image/*" hidden>' +
      '<div class="uprog" id="bwBgProg" style="display:none"><div class="uprog-bar" id="bwBgProgBar" style="width:0%"></div></div>' +
      '</div>';

    /* heroes */
    h += '<div class="ph" style="margin-top:18px"><span class="pt">Hero Slides</span><button class="abtn solid" data-a="hero-new">+ New Slide</button></div>';
    h += state.heroes.length ? state.heroes.map(function (x, i) {
      return itemShell(
        x.image_url ? '<img src="' + safeUrl(x.image_url) + '" alt="" style="width:100%;height:100%;object-fit:cover">' : '',
        esc(x.title || 'Untitled slide'),
        esc(x.subtitle || 'No subtitle') + (x.cta_text ? ' \u00b7 ' + esc(x.cta_text) : '') + ' \u00b7 #' + esc(x.sort_order),
        x.active !== false,
        moveBtns(x.id, i, state.heroes.length) +
        '<button class="abtn" data-a="hero-edit" data-id="' + esc(x.id) + '">Edit</button>' +
        '<button class="abtn" data-a="hero-toggle" data-id="' + esc(x.id) + '">' + (x.active !== false ? 'Pause' : 'Resume') + '</button>' +
        '<button class="abtn danger" data-a="hero-del" data-id="' + esc(x.id) + '">Delete</button>'
      );
    }).join('') : '<div class="ad-empty">No hero slides yet. Add one — JPG, PNG, WebP or GIF (GIFs keep animating).</div>';

    /* categories */
    h += '<div class="ph" style="margin-top:18px"><span class="pt">Beauty Categories</span><button class="abtn solid" data-a="cat-new">+ New Category</button></div>';
    h += state.cats.length ? state.cats.map(function (x, i) {
      var meta = kindLabel(x.kind) + (x.kind === 'category' ? ' \u00b7 ' + esc(catLabel(x.category_id)) : '') + ' \u00b7 #' + esc(x.sort_order);
      return itemShell(
        x.image_url ? '<img src="' + safeUrl(x.image_url) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">' :
          '<div style="width:100%;height:100%;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;font-weight:800">' + esc((x.name || '?')[0].toUpperCase()) + '</div>',
        esc(x.name),
        meta,
        x.active !== false,
        moveBtns(x.id, i, state.cats.length) +
        '<button class="abtn" data-a="cat-edit" data-id="' + esc(x.id) + '">Edit</button>' +
        '<button class="abtn" data-a="cat-toggle" data-id="' + esc(x.id) + '">' + (x.active !== false ? 'Hide' : 'Show') + '</button>' +
        '<button class="abtn danger" data-a="cat-del" data-id="' + esc(x.id) + '">Delete</button>'
      );
    }).join('') : '<div class="ad-empty">No Beauty categories yet. Add tiles like Makeup, Skincare, Fragrance\u2026</div>';

    pane().innerHTML = h;
  }

  /* ── forms ────────────────────────────────────────────────────── */

  function blankHero() { return { id: null, image_url: '', title: '', subtitle: '', cta_text: '', link_url: '', sort_order: (state.heroes.length ? Math.max.apply(null, state.heroes.map(function (x) { return x.sort_order || 0; })) + 10 : 10), active: true }; }
  function blankCat() { return { id: null, name: '', slug: '', kind: 'category', category_id: null, keywords: '', image_url: '', sort_order: (state.cats.length ? Math.max.apply(null, state.cats.map(function (x) { return x.sort_order || 0; })) + 10 : 10), active: true }; }

  function renderForm() {
    var c = state.cur, isHero = state.kind === 'hero';
    var h = '<div class="fcard" id="bwForm"><h3>' + (isHero ? (c.id ? 'Edit Hero Slide' : 'New Hero Slide') : (c.id ? 'Edit Beauty Category' : 'New Beauty Category')) + '</h3>';

    h += '<div class="fg"><label>' + (isHero ? 'Slide image (JPG / PNG / WebP / GIF)' : 'Tile image (JPG / PNG / WebP / GIF, optional)') + '</label><div data-pk="image_url" data-max="1" data-label="Add image"></div></div>';

    if (isHero) {
      h += '<div class="fg"><label>Title (optional)</label><input type="text" data-f="title" maxlength="80" placeholder="e.g. Summer Glow Collection" value="' + esc(c.title) + '"></div>';
      h += '<div class="fg"><label>Subtitle (optional)</label><input type="text" data-f="subtitle" maxlength="120" placeholder="e.g. New skincare drops, real brands" value="' + esc(c.subtitle) + '"></div>';
      h += '<div class="fg"><label>Button text (optional)</label><input type="text" data-f="cta_text" maxlength="40" placeholder="Shop now" value="' + esc(c.cta_text) + '"></div>';
      h += '<div class="fg"><label>Destination (optional)</label><input type="text" data-f="link_url" placeholder="#cat=makeup or /store/xyz or https://\u2026" value="' + esc(c.link_url) + '"></div>' +
        '<div class="ad-hint">Internal hashes (like #cat=makeup) open the matching page inside the store; full URLs open as normal links.</div></div>';
    } else {
      h += '<div class="fg"><label>Name *</label><input type="text" data-f="name" maxlength="40" placeholder="e.g. Skincare" value="' + esc(c.name) + '"></div>';
      h += '<div class="fg"><label>Type</label><select data-f="kind" data-re="1">' +
        '<option value="category"' + (c.kind === 'category' ? ' selected' : '') + '>Products of a category</option>' +
        '<option value="all"' + (c.kind === 'all' ? ' selected' : '') + '>All Beauty products</option>' +
        '<option value="new"' + (c.kind === 'new' ? ' selected' : '') + '>Newest Beauty products</option>' +
        '<option value="best"' + (c.kind === 'best' ? ' selected' : '') + '>Best sellers (real sales &amp; reviews)</option>' +
        '</select></div>';
      if (c.kind === 'category') {
        h += '<div class="fg"><label>Link to an existing category (optional)</label><div data-pk-cat></div>' +
          '<div class="ad-hint">When set, the tile shows exactly the products filed in that category (and its subcategories) — the same relationship the rest of the store uses. When empty, the tile falls back to matching products whose category name contains the keywords below.</div></div>';
        h += '<div class="fg"><label>Keywords (used only when no category is linked)</label><input type="text" data-f="keywords" placeholder="e.g. skincare, skin care, face wash" value="' + esc(c.keywords) + '"></div>';
      }
    }

    h += '<div class="fg"><label>Order</label><input type="number" min="1" data-f="sort_order" value="' + esc(c.sort_order) + '"></div>';
    h += '<div style="background:var(--bg2);border-radius:10px;padding:2px 10px;margin-bottom:12px"><div class="tgl-row"><label>Active (visible to shoppers)</label><div class="tgl' + (c.active !== false ? ' on' : '') + '" data-tgl="active"><div class="tgl-k"></div></div></div></div>';
    h += '<div class="form-btns"><button class="btn-p" data-a="save">Save</button><button class="btn-s" data-a="cancel">Cancel</button></div>';
    h += '<div class="uprog" id="bwProg"><div class="uprog-bar" id="bwProgBar" style="width:0%"></div></div></div>';

    pane().innerHTML = h;
    mountPicker(isHero, c);
    if (!isHero && c.kind === 'category') mountCatPicker(c);
  }

  function mountPicker(isHero, c) {
    var el = pane().querySelector('[data-pk]');
    var picker = new Pcx.MultiImagePicker(el, {
      max: 1,
      label: el.dataset.label || 'Add image',
      upload: async function (file) {
        state.uploading++;
        try { return await uploadImage(file, isHero ? 'beauty-hero' : 'beauty-cat', 'bwProgBar', 'bwProg'); }
        finally { state.uploading--; }
      },
      onChange: function (urls) { state.cur.image_url = urls[0] || ''; },
      onError: function (err) { toast('Upload failed: ' + (err && err.message || err), true); }
    });
    picker.setImages(c.image_url ? [c.image_url] : []);
  }

  function mountCatPicker(c) {
    var el = pane().querySelector('[data-pk-cat]');
    state.catPicker = new Pcx.CategoryPicker(el, { includeInactive: true, placeholder: 'Link a category (optional)' });
    if (typeof catTree !== 'undefined' && catTree) state.catPicker.setTree(catTree);
    state.catPicker.setValue(c.category_id);
    /* the picked id is read via getValue() at save time */
  }

  /* ── save ─────────────────────────────────────────────────────── */

  async function saveHero() {
    var c = state.cur;
    if (!c.image_url) { toast('Add a slide image first', true); return; }
    if (state.uploading) { toast('Wait for the image upload to finish', true); return; }
    var row = {
      image_url: c.image_url,
      title: (c.title || '').trim() || null,
      subtitle: (c.subtitle || '').trim() || null,
      cta_text: (c.cta_text || '').trim() || null,
      link_url: (c.link_url || '').trim() || null,
      sort_order: parseInt(c.sort_order, 10) || 10,
      active: c.active !== false
    };
    showLoad('Saving slide...');
    var res = await (c.id ? sb.from('beauty_heroes').update(row).eq('id', c.id) : sb.from('beauty_heroes').insert([row]));
    hideLoad();
    if (res.error) { toast('Save failed: ' + explain(res.error.message), true); return; }
    toast(c.id ? 'Slide updated' : 'Slide added');
    state.cur = null;
    await load(); render();
  }

  async function saveCat() {
    var c = state.cur;
    var name = (c.name || '').trim();
    if (!name) { toast('Category name required', true); return; }
    if (state.uploading) { toast('Wait for the image upload to finish', true); return; }
    var kind = c.kind === 'all' || c.kind === 'new' || c.kind === 'best' ? c.kind : 'category';
    var slug = c.id && c.slug ? c.slug : B.slugify(name);
    /* keep slugs unique across the tiles */
    var clash = state.cats.some(function (x) { return x.slug === slug && String(x.id) !== String(c.id); });
    var n = 2;
    while (clash) { slug = B.slugify(name) + '-' + n; clash = state.cats.some(function (x) { return x.slug === slug && String(x.id) !== String(c.id); }); n++; }
    var row = {
      name: name,
      slug: slug,
      kind: kind,
      category_id: kind === 'category' && state.catPicker && state.catPicker.getValue() != null ? Number(state.catPicker.getValue()) : null,
      keywords: kind === 'category' ? ((c.keywords || '').trim() || null) : null,
      image_url: c.image_url || null,
      sort_order: parseInt(c.sort_order, 10) || 10,
      active: c.active !== false
    };
    showLoad('Saving category...');
    var res = await (c.id ? sb.from('beauty_categories').update(row).eq('id', c.id) : sb.from('beauty_categories').insert([row]));
    hideLoad();
    if (res.error) { toast('Save failed: ' + explain(res.error.message), true); return; }
    toast(c.id ? 'Category updated' : 'Category added');
    state.cur = null;
    await load(); render();
  }

  async function saveBg() {
    showLoad('Saving background...');
    var res = await Promise.all([
      sb.from('beauty_settings').upsert([{ key: 'background_url', value: state.settings.background_url || '' }], { onConflict: 'key' }),
      sb.from('beauty_settings').upsert([{ key: 'background_enabled', value: state.settings.background_enabled === '0' ? '0' : '1' }], { onConflict: 'key' })
    ]);
    hideLoad();
    if (res.some(function (x) { return x.error; })) { toast('Save failed: ' + explain((res[0].error || res[1].error).message), true); return; }
    toast('Background saved');
    await load(); render();
  }

  /* ── events ───────────────────────────────────────────────────── */

  function byId(list, id) { return list.find(function (x) { return String(x.id) === String(id); }); }
  function idx(list, id) { return list.findIndex(function (x) { return String(x.id) === String(id); }); }

  function onAction(e) {
    var b = e.target.closest('[data-a]');
    if (!b || !pane().contains(b)) return;
    var a = b.dataset.a, id = b.dataset.id;

    if (a === 'bg-upload') { document.getElementById('bwBgFile').click(); return; }
    if (a === 'bg-remove') {
      state.settings.background_url = '';
      saveBg();
      return;
    }
    if (a === 'hero-new') { state.kind = 'hero'; state.cur = blankHero(); renderForm(); return; }
    if (a === 'cat-new') { state.kind = 'cat'; state.cur = blankCat(); renderForm(); return; }
    if (a === 'hero-edit') { var rh = byId(state.heroes, id); if (rh) { state.kind = 'hero'; state.cur = Object.assign(blankHero(), rh); renderForm(); } return; }
    if (a === 'cat-edit') { var rc = byId(state.cats, id); if (rc) { state.kind = 'cat'; state.cur = Object.assign(blankCat(), rc); renderForm(); } return; }
    if (a === 'cancel') { state.cur = null; state.catPicker = null; render(); return; }
    if (a === 'save') { (state.kind === 'hero' ? saveHero() : saveCat()); return; }

    if (a === 'hero-toggle') {
      var th = byId(state.heroes, id); if (!th) return;
      sb.from('beauty_heroes').update({ active: th.active === false }).eq('id', th.id).then(function (res) {
        if (res.error) { toast('Update failed: ' + explain(res.error.message), true); return; }
        toast(th.active === false ? 'Slide resumed' : 'Slide paused'); load().then(render);
      });
      return;
    }
    if (a === 'cat-toggle') {
      var tc = byId(state.cats, id); if (!tc) return;
      sb.from('beauty_categories').update({ active: tc.active === false }).eq('id', tc.id).then(function (res) {
        if (res.error) { toast('Update failed: ' + explain(res.error.message), true); return; }
        toast(tc.active === false ? 'Category shown' : 'Category hidden'); load().then(render);
      });
      return;
    }
    if (a === 'hero-del') {
      var dh = byId(state.heroes, id); if (!dh) return;
      confirm('Delete Slide', 'Remove this hero slide permanently?', async function () {
        showLoad('Deleting...');
        var res = await sb.from('beauty_heroes').delete().eq('id', dh.id);
        hideLoad();
        if (res.error) { toast('Delete failed: ' + explain(res.error.message), true); return; }
        toast('Slide deleted'); await load(); render();
      });
      return;
    }
    if (a === 'cat-del') {
      var dc = byId(state.cats, id); if (!dc) return;
      confirm('Delete Category', 'Remove the \u201c' + dc.name + '\u201d tile? Products and their real categories are not touched.', async function () {
        showLoad('Deleting...');
        var res = await sb.from('beauty_categories').delete().eq('id', dc.id);
        hideLoad();
        if (res.error) { toast('Delete failed: ' + explain(res.error.message), true); return; }
        toast('Category tile deleted'); await load(); render();
      });
      return;
    }
    if (a === 'up' || a === 'down') {
      if (byId(state.heroes, id)) reorder('beauty_heroes', state.heroes, idx(state.heroes, id) + (a === 'up' ? -1 : 0));
      else if (byId(state.cats, id)) reorder('beauty_categories', state.cats, idx(state.cats, id) + (a === 'up' ? -1 : 0));
      return;
    }
  }

  function onToggle(e) {
    var t = e.target.closest('[data-tgl]');
    if (!t || !pane().contains(t)) return;
    t.classList.toggle('on');
    if (t.dataset.tgl === 'bg') state.settings.background_enabled = t.classList.contains('on') ? '1' : '0';
    else if (state.cur) state.cur[t.dataset.tgl] = t.classList.contains('on');
  }

  function onInput(e) {
    var el = e.target, f = el.dataset && el.dataset.f;
    if (!f || !state.cur) return;
    state.cur[f] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    if (f === 'kind') { state.cur.kind = el.value; renderForm(); }
  }

  function bind() {
    var p = pane();
    if (p.dataset.bwBound) return;
    p.dataset.bwBound = '1';
    p.addEventListener('click', function (e) { onToggle(e); onAction(e); });
    p.addEventListener('input', onInput);
    /* delegated: the hidden file input is re-created on every render() */
    p.addEventListener('change', function (e) {
      var el = e.target;
      if (!el || el.id !== 'bwBgFile') return;
      var f = el.files && el.files[0];
      if (!f) return;
      showLoad('Uploading background...');
      var prog = document.getElementById('bwBgProg');
      if (prog) prog.style.display = '';
      uploadImage(f, 'beauty-background', 'bwBgProgBar', 'bwBgProg').then(function (url) {
        hideLoad();
        state.settings.background_url = url;
        return saveBg();
      }).catch(function (err) {
        hideLoad();
        toast('Upload failed: ' + (err && err.message || err), true);
      }).finally(function () { if (prog) prog.style.display = 'none'; el.value = ''; });
    });
  }

  /* the product form's category tree can load after this module exists */
  document.addEventListener('categories:loaded', function () {
    if (state.cur && state.kind === 'cat' && state.catPicker) state.catPicker.setTree(catTree);
  });

  window.BeautyAdmin = {
    open: async function () {
      if (!state.loaded) {
        pane().innerHTML = '<div class="ad-empty">Loading Beauty\u2026</div>';
        try { await load(); } catch (e) { state.tableMissing = true; }
      }
      if (!state.cur) render();
      bind();
    },
    reload: async function () {
      state.loaded = false; state.cur = null;
      await load(); render();
    }
  };
})();
