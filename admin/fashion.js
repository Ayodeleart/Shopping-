/* Admin: Fashion world manager (tab "Fashion").
 *
 * Four sub-screens, all persisting to Supabase (see migration_fashion.sql):
 *   • Gender Cards  — `fashion_genders`: media (image or GIF) per card, name, order, active
 *   • Hero Ads      — `fashion_ads`: add/edit/replace/delete, link, order, active
 *   • Categories    — the REAL subcategories under Fashion & Clothing / Kids Fashion
 *                     (Pcx.Fashion.fashionCategories): reorder + hide/show only. Names,
 *                     images/GIFs, parents and new subcategories are edited on the main
 *                     Categories admin screen — the same rows, not a copy of them.
 *   • Sections      — `fashion_sections`: discovery rails (title, type, category/vendor/
 *                     gender link, limit, order, active)
 *
 * Reuses the admin's shared helpers (globals from admin/index.html): sb, toast, confirm,
 * showLoad, hideLoad, uploadImage (GIFs go up untouched so they keep animating; PNG/WebP/GIF
 * keep transparency), Pcx.MultiImagePicker, Pcx.CategoryPicker, data/categories.js.
 */
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var $ = function (id) { return document.getElementById(id); };

  var sub = 'genders';
  var genders = [], ads = [], sections = [], catRows = [], tree = null, vendors = [];
  var loaded = { genders: false, ads: false, cats: false, sections: false, vendors: false };
  var missing = {};
  var editingAd = null, editingSec = null;
  var genderPickers = {};

  var GENDERS = [
    { slug: 'men', name: 'Men' },
    { slug: 'women', name: 'Women' },
    { slug: 'boys', name: 'Boys' },
    { slug: 'girls', name: 'Girls' }
  ];
  var SECTION_TYPES = [
    ['category', 'Products of one category'],
    ['vendor', 'Products of one seller'],
    ['gender', 'Products for Men / Women / Boys / Girls'],
    ['new', 'Newest fashion products'],
    ['featured', 'Featured products'],
    ['sale', 'Products on discount']
  ];

  function explain(m) {
    m = (m && m.message) || String(m);
    if (/42P01|PGRST205|relation .*does not exist|Could not find the table|schema cache/i.test(m)) return 'The Fashion tables are missing. Run migration_fashion.sql in the Supabase SQL editor.';
    if (/row-level security|policy/i.test(m)) return 'Blocked by row-level security. Run migration_fashion.sql and sign in with the admin Google account.';
    return m;
  }
  function uploadMsg(err) {
    var m = (err && err.message) || String(err);
    return /row-level security|policy/i.test(m) ? 'Upload blocked by the storage policy. Run the ads and storage SQL in the Supabase SQL editor.' : m;
  }

  window.switchFashionSub = function (which) {
    sub = which;
    document.querySelectorAll('[data-fwsub]').forEach(function (t) { t.classList.toggle('on', t.dataset.fwsub === which); });
    ['genders', 'ads', 'cats', 'sections'].forEach(function (k) {
      var el = $('fwPane-' + k);
      if (el) el.style.display = k === which ? '' : 'none';
    });
    ensureLoaded();
  };

  async function ensureLoaded() {
    if (sub === 'genders' && !loaded.genders) await loadGenders();
    if (sub === 'ads' && !loaded.ads) await loadAds();
    if (sub === 'cats' && !loaded.cats) await loadCats();
    if (sub === 'sections' && !loaded.sections) { await loadCats(); await loadVendors(); await loadSections(); }
    render();
  }

  /* the admin tab button also switches panels via its own handler; render when Fashion shows */
  window.FashionAdmin = { open: ensureLoaded };

  /* ================================================================ GENDER CARDS */
  async function loadGenders() {
    var r = await sb.from('fashion_genders').select('*').order('sort_order', { ascending: true });
    missing.genders = !!r.error;
    genders = r.data || [];
    loaded.genders = true;
  }

  function genderRow(slug) {
    return genders.filter(function (g) { return g.slug === slug; })[0] ||
      { slug: slug, name: (GENDERS.filter(function (g) { return g.slug === slug; })[0] || {}).name || slug, media_url: '', active: true, sort_order: 1, accent: '' };
  }

  function renderGenders() {
    var pane = $('fwPane-genders');
    pane.innerHTML =
      '<div class="ph"><span class="pt">Gender Cards</span></div>' +
      '<div class="ad-hint" style="margin:-4px 0 12px">The four compact cards at the top of the Fashion world. The uploaded image or GIF (transparent background-removed GIFs are perfect) shows on the ACTIVE card only; inactive cards stay white. Portrait artwork works best \u2014 it is shown whole, never cropped.</div>' +
      (missing.genders ? '<div class="ad-empty">The Fashion tables are not set up yet. Run <b>migration_fashion.sql</b> in the Supabase SQL editor, then reopen this tab.</div>' : '') +
      (missing.genders ? '' : GENDERS.map(function (g) {
        var row = genderRow(g.slug);
        return '<div class="fcard" data-gender="' + g.slug + '"><h3>' + esc(row.name) + '</h3>' +
          '<div class="fg"><label>Card image or GIF</label><div data-pk="' + g.slug + '"></div></div>' +
          '<div class="row2">' +
            '<div class="fg"><label>Title</label><input type="text" data-f="name" maxlength="30" value="' + esc(row.name) + '"></div>' +
            '<div class="fg"><label>Display order</label><input type="number" min="1" data-f="sort_order" value="' + esc(row.sort_order || 1) + '"></div>' +
          '</div>' +
          '<div style="background:var(--bg2);border-radius:10px;padding:2px 10px;margin-bottom:6px"><div class="tgl-row"><label>Enabled (visible to shoppers)</label><div class="tgl' + (row.active !== false ? ' on' : '') + '" data-tgl="active"><div class="tgl-k"></div></div></div></div>' +
          '<div class="form-btns"><button class="btn-p" data-a="save-gender" data-slug="' + g.slug + '">Save Card</button>' +
          (row.media_url ? '<button class="btn-s" data-a="clear-media" data-slug="' + g.slug + '">Remove media</button>' : '') + '</div>' +
          '<div class="uprog" id="fwgProg-' + g.slug + '"><div class="uprog-bar" id="fwgProgBar-' + g.slug + '" style="width:0%"></div></div>' +
          '</div>';
      }).join(''));

    if (missing.genders) return;
    GENDERS.forEach(function (g) {
      var card = pane.querySelector('[data-gender="' + g.slug + '"]');
      var row = genderRow(g.slug);
      var picker = new Pcx.MultiImagePicker(card.querySelector('[data-pk="' + g.slug + '"]'), {
        max: 1, label: 'Add image or GIF',
        upload: async function (file) {
          return uploadImage(file, 'fashion/genders', 'fwgProgBar-' + g.slug, 'fwgProg-' + g.slug, /png|webp|gif/.test(file.type));
        },
        onChange: function (urls) { row.media_url = urls[0] || ''; },
        onError: function (err) { toast(uploadMsg(err), true); }
      });
      picker.setImages(row.media_url ? [row.media_url] : []);
      row._picker = picker;
      genderPickers[g.slug] = picker;
    });
  }

  async function saveGender(slug) {
    var card = document.querySelector('[data-gender="' + slug + '"]');
    var row = genderRow(slug);
    if (row._uploading) return toast('Wait for the upload to finish', true);
    var name = card.querySelector('[data-f="name"]').value.trim();
    var order = parseInt(card.querySelector('[data-f="sort_order"]').value, 10) || 1;
    var active = card.querySelector('[data-tgl="active"]').classList.contains('on');
    showLoad('Saving gender card...');
    var res = await sb.from('fashion_genders').upsert({
      slug: slug, name: name || slug, media_url: row.media_url || null,
      accent: row.accent || null, active: active, sort_order: order, updated_at: new Date().toISOString()
    }, { onConflict: 'slug' });
    hideLoad();
    if (res.error) return toast('Save failed: ' + explain(res.error), true);
    toast('Gender card saved');
    await loadGenders();
    renderGenders();
  }

  async function clearGenderMedia(slug) {
    showLoad('Removing media...');
    var res = await sb.from('fashion_genders').update({ media_url: null }).eq('slug', slug);
    hideLoad();
    if (res.error) return toast('Remove failed: ' + explain(res.error), true);
    toast('Media removed');
    await loadGenders();
    renderGenders();
  }

  /* ================================================================ HERO ADS */
  async function loadAds() {
    var r = await sb.from('fashion_ads').select('*').order('sort_order', { ascending: true });
    missing.ads = !!r.error;
    ads = r.data || [];
    loaded.ads = true;
  }

  function renderAds() {
    var pane = $('fwPane-ads');
    if (editingAd) return renderAdForm();
    pane.innerHTML =
      '<div class="ph"><span class="pt">Fashion Hero Ads</span><button class="abtn solid" data-a="new-ad">+ New Ad</button></div>' +
      '<div class="ad-hint" style="margin:-4px 0 12px">The auto-transitioning hero at the top of the Fashion world. Images and animated GIFs both work; add several to get a carousel with swipe.</div>' +
      (missing.ads ? '<div class="ad-empty">The Fashion tables are not set up yet. Run <b>migration_fashion.sql</b> in the Supabase SQL editor, then reopen this tab.</div>' : '') +
      (ads.length ? ads.map(function (a) {
        var live = a.active !== false;
        return '<div class="aditem">' +
          '<div class="aditem-img" style="width:64px;height:64px">' + (a.image_url ? '<img src="' + safeUrl(a.image_url) + '" alt="" style="object-fit:contain">' : '') + '</div>' +
          '<div class="aditem-body"><div class="aditem-name">' + esc(a.title || 'Untitled ad') + '<span class="pill' + (live ? ' live' : '') + '">' + (live ? 'Live' : 'Paused') + '</span></div>' +
          '<div class="aditem-meta">Order ' + esc(a.sort_order || 1) + (a.href ? ' \u00b7 links somewhere' : ' \u00b7 no link') + '</div></div>' +
          '<div class="aditem-acts">' +
            '<button class="abtn" data-a="edit-ad" data-id="' + esc(a.id) + '">Edit</button>' +
            '<button class="abtn" data-a="toggle-ad" data-id="' + esc(a.id) + '">' + (live ? 'Pause' : 'Resume') + '</button>' +
            '<button class="abtn danger" data-a="delete-ad" data-id="' + esc(a.id) + '">Delete</button>' +
          '</div></div>';
      }).join('') : (missing.ads ? '' : '<div class="ad-empty">No hero ads yet. Add an image or GIF \u2014 it starts rotating as soon as there are two or more.</div>'));
  }

  function renderAdForm() {
    var a = editingAd || {};
    var pane = $('fwPane-ads');
    pane.innerHTML =
      '<div class="fcard"><h3>' + (a.id ? 'Edit Ad' : 'New Fashion Ad') + '</h3>' +
      '<div class="fg"><label>Image or GIF</label><div data-pk></div>' +
        '<div class="ad-hint">Animated and transparent GIFs are uploaded untouched so they keep animating.</div></div>' +
      '<div class="fg"><label>Internal title (not shown to shoppers)</label><input type="text" data-f="title" maxlength="80" placeholder="e.g. Owambe season" value="' + esc(a.title || '') + '"></div>' +
      '<div class="fg"><label>Destination (optional)</label><input type="text" data-f="href" placeholder="https://... or #cat=shoes" value="' + esc(a.href || '') + '">' +
        '<div class="ad-hint">A full URL opens in a new tab. An in-app link like <b>#cat=shoes</b> or <b>#world=fashion</b> opens inside the store.</div></div>' +
      '<div class="fg"><label>Display order</label><input type="number" min="1" data-f="sort_order" value="' + esc(a.sort_order || 1) + '"></div>' +
      '<div style="background:var(--bg2);border-radius:10px;padding:2px 10px;margin-bottom:6px"><div class="tgl-row"><label>Active (visible to shoppers)</label><div class="tgl' + (a.active !== false ? ' on' : '') + '" data-tgl="active"><div class="tgl-k"></div></div></div></div>' +
      '<div class="form-btns"><button class="btn-p" data-a="save-ad">Save Ad</button><button class="btn-s" data-a="cancel-ad">Cancel</button>' +
      (a.id ? '<button class="btn-d" data-a="delete-ad" data-id="' + esc(a.id) + '">Delete</button>' : '') + '</div>' +
      '<div class="uprog" id="fwaProg"><div class="uprog-bar" id="fwaProgBar" style="width:0%"></div></div></div>';

    editingAd._uploading = 0;
    var picker = new Pcx.MultiImagePicker(pane.querySelector('[data-pk]'), {
      max: 1, label: 'Add image or GIF',
      upload: async function (file) {
        editingAd._uploading++;
        try { return await uploadImage(file, 'fashion/ads', 'fwaProgBar', 'fwaProg', /png|webp|gif/.test(file.type)); }
        finally { editingAd._uploading--; }
      },
      onChange: function (urls) { editingAd.image_url = urls[0] || ''; },
      onError: function (err) { toast(uploadMsg(err), true); }
    });
    picker.setImages(a.image_url ? [a.image_url] : []);
  }

  async function saveAd() {
    var pane = $('fwPane-ads');
    if (editingAd._uploading) return toast('Wait for the upload to finish', true);
    if (!editingAd.image_url) return toast('Add an image or GIF first', true);
    var row = {
      title: pane.querySelector('[data-f="title"]').value.trim() || null,
      href: pane.querySelector('[data-f="href"]').value.trim() || null,
      sort_order: parseInt(pane.querySelector('[data-f="sort_order"]').value, 10) || 1,
      active: pane.querySelector('[data-tgl="active"]').classList.contains('on'),
      image_url: editingAd.image_url
    };
    showLoad('Saving ad...');
    var res = editingAd.id ? await sb.from('fashion_ads').update(row).eq('id', editingAd.id)
                           : await sb.from('fashion_ads').insert([row]);
    hideLoad();
    if (res.error) return toast('Save failed: ' + explain(res.error), true);
    toast(editingAd.id ? 'Ad updated' : 'Ad added');
    editingAd = null;
    await loadAds();
    renderAds();
  }

  async function toggleAd(id) {
    var a = ads.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!a) return;
    var res = await sb.from('fashion_ads').update({ active: a.active === false }).eq('id', a.id);
    if (res.error) return toast('Failed: ' + explain(res.error), true);
    await loadAds();
    renderAds();
  }

  function deleteAd(id) {
    confirm('Delete ad', 'Remove this Fashion hero ad?', async function () {
      showLoad('Deleting...');
      var res = await sb.from('fashion_ads').delete().eq('id', id);
      hideLoad();
      if (res.error) return toast('Delete failed: ' + explain(res.error), true);
      toast('Ad deleted');
      if (editingAd && String(editingAd.id) === String(id)) editingAd = null;
      await loadAds();
      renderAds();
    });
  }

  /* ================================================================ FASHION CATEGORIES */
  async function loadCats() {
    var r = await Pcx.Categories.fetchAll(sb, { includeInactive: true });
    missing.cats = !!r.error;
    catRows = r.rows || [];
    tree = new Pcx.Categories.Tree(catRows);
    loaded.cats = true;
    document.dispatchEvent(new CustomEvent('categories:loaded', { detail: tree }));
  }

  /* The real subcategories under Fashion & Clothing / Kids Fashion (any depth-1 child
     of either root) — the SAME rows the main Categories admin screen manages. This
     panel only reorders/hides them for the Fashion world; it never creates a second
     copy of the taxonomy. */
  function fashionCats() {
    return Pcx.Fashion.fashionCategories(tree);
  }

  async function loadVendors() {
    var r = await sb.from('vendors_public').select('id,business_name,status').order('business_name', { ascending: true });
    vendors = r.data || [];
    loaded.vendors = true;
  }

  function renderCats() {
    var pane = $('fwPane-cats');
    var cats = fashionCats();
    var roots = tree ? Pcx.Fashion.fashionRoots(tree) : [];
    var rootNames = roots.map(function (r) { return r.name; }).join(' and ');
    pane.innerHTML =
      '<div class="ph"><span class="pt">Fashion Categories</span></div>' +
      '<div class="ad-hint" style="margin:-4px 0 12px">' +
        (roots.length
          ? 'The circular tiles in the Fashion world are the real subcategories under <b>' + esc(rootNames) + '</b>. Reorder or hide them below \u2014 names, images/GIFs and new subcategories are added on the main <b>Categories</b> screen, and show up here automatically.'
          : 'Could not find the "Fashion & Clothing" or "Kids Fashion" categories (expected slugs <code>fashion-clothing</code> / <code>kids-fashion</code>). Check the main Categories screen.') +
      '</div>' +
      (cats.length ? cats.map(function (c) {
        var live = c.active;
        return '<div class="aditem">' +
          '<div style="width:56px;height:56px;flex-shrink:0;border-radius:50%;overflow:hidden;background:var(--bg2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--txt3)">' +
            (Pcx.Categories.imageUrl(c)
              ? '<img src="' + safeUrl(Pcx.Categories.imageUrl(c)) + '" alt="" style="width:100%;height:100%;object-fit:contain">'
              : esc((c.name[0] || '?').toUpperCase())) + '</div>' +
          '<div class="aditem-body"><div class="aditem-name">' + esc(c.name) + '<span class="pill' + (live ? ' live' : '') + '">' + (live ? 'Live' : 'Hidden') + '</span></div>' +
          '<div class="aditem-meta">' + esc(c.slug) + ' \u00b7 order ' + esc(c.sortOrder) + '</div></div>' +
          '<div class="aditem-acts">' +
            '<button class="abtn" data-a="up-cat" data-id="' + esc(c.id) + '">↑</button>' +
            '<button class="abtn" data-a="down-cat" data-id="' + esc(c.id) + '">↓</button>' +
            '<button class="abtn" data-a="toggle-cat" data-id="' + esc(c.id) + '">' + (live ? 'Hide' : 'Show') + '</button>' +
          '</div></div>';
      }).join('') : (roots.length ? '<div class="ad-empty">No subcategories under ' + esc(rootNames) + ' yet. Add them on the main Categories screen.</div>' : ''));
  }

  async function toggleCat(id) {
    var c = tree.byId[id];
    if (!c) return;
    var res = await sb.from('categories').update({ is_active: !c.active }).eq('id', id);
    if (res.error) return toast(explain(res.error), true);
    toast(c.active ? 'Category hidden' : 'Category shown');
    await loadCats();
    renderCats();
  }

  async function moveCat(id, dir) {
    var cats = fashionCats();
    var i = cats.findIndex(function (c) { return c.id === id; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= cats.length) return;
    var t = cats[i]; cats[i] = cats[j]; cats[j] = t;
    var changes = cats.map(function (c, k) { return { id: c.id, sort_order: (k + 1) * 10 }; });
    showLoad('Reordering...');
    var results = await Promise.all(changes.map(function (ch) { return sb.from('categories').update({ sort_order: ch.sort_order }).eq('id', ch.id); }));
    hideLoad();
    var bad = results.filter(function (r) { return r.error; })[0];
    if (bad) return toast(explain(bad.error), true);
    await loadCats();
    renderCats();
  }

  /* ================================================================ SECTIONS */
  async function loadSections() {
    var r = await sb.from('fashion_sections').select('*').order('sort_order', { ascending: true });
    missing.sections = !!r.error;
    sections = r.data || [];
    loaded.sections = true;
  }

  function renderSections() {
    var pane = $('fwPane-sections');
    if (editingSec) return renderSecForm();
    pane.innerHTML =
      '<div class="ph"><span class="pt">Fashion Discovery Sections</span><button class="abtn solid" data-a="new-sec">+ New Section</button></div>' +
      '<div class="ad-hint" style="margin:-4px 0 12px">Product rails on the Fashion world, in the order below. Sections with no real products hide themselves on the storefront. Rails you have not configured (New, Trending, per-gender, top sellers, categories) are added automatically from real data.</div>' +
      (missing.sections ? '<div class="ad-empty">The Fashion tables are not set up yet. Run <b>migration_fashion.sql</b> in the Supabase SQL editor, then reopen this tab.</div>' : '') +
      (sections.length ? sections.map(function (s) {
        var live = s.active !== false;
        var where = '';
        if (s.type === 'category') {
          var c = tree && s.category_id != null ? tree.byId[s.category_id] : null;
          where = c ? c.name : 'category #' + s.category_id;
        } else if (s.type === 'vendor') {
          var v = vendors.filter(function (x) { return x.id === s.vendor_id; })[0];
          where = v ? v.business_name : 'seller';
        } else if (s.type === 'gender') {
          where = s.gender || '';
        } else {
          where = (SECTION_TYPES.filter(function (t) { return t[0] === s.type; })[0] || [, s.type])[1];
        }
        return '<div class="aditem">' +
          '<div class="aditem-body"><div class="aditem-name">' + esc(s.title) + '<span class="pill' + (live ? ' live' : '') + '">' + (live ? 'Live' : 'Paused') + '</span></div>' +
          '<div class="aditem-meta">' + esc(where) + ' \u00b7 up to ' + esc(s.item_limit || 12) + ' products \u00b7 order ' + esc(s.sort_order || 1) + '</div></div>' +
          '<div class="aditem-acts">' +
            '<button class="abtn" data-a="up-sec" data-id="' + esc(s.id) + '">↑</button>' +
            '<button class="abtn" data-a="down-sec" data-id="' + esc(s.id) + '">↓</button>' +
            '<button class="abtn" data-a="edit-sec" data-id="' + esc(s.id) + '">Edit</button>' +
            '<button class="abtn" data-a="toggle-sec" data-id="' + esc(s.id) + '">' + (live ? 'Pause' : 'Resume') + '</button>' +
            '<button class="abtn danger" data-a="delete-sec" data-id="' + esc(s.id) + '">Delete</button>' +
          '</div></div>';
      }).join('') : (missing.sections ? '' : '<div class="ad-empty">No custom sections yet \u2014 the Fashion world builds its rails from real data automatically. Add one to take control of a rail.</div>'));
  }

  function renderSecForm() {
    var s = editingSec;
    var pane = $('fwPane-sections');
    pane.innerHTML =
      '<div class="fcard"><h3>' + (s.id ? 'Edit Section' : 'New Section') + '</h3>' +
      '<div class="fg"><label>Title *</label><input type="text" data-f="title" maxlength="60" placeholder="e.g. Shoes You&#39;ll Love" value="' + esc(s.title || '') + '"></div>' +
      '<div class="fg"><label>Section type</label><select data-f="type">' +
        SECTION_TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (s.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') +
      '</select></div>' +
      '<div data-sec-cat class="fg" style="display:none"><label>Category</label><div data-cp></div></div>' +
      '<div data-sec-vendor class="fg" style="display:none"><label>Seller</label><select data-f="vendor_id"><option value="">Choose a seller...</option>' +
        vendors.map(function (v) { return '<option value="' + esc(v.id) + '"' + (s.vendor_id === v.id ? ' selected' : '') + '>' + esc(v.business_name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div data-sec-gender class="fg" style="display:none"><label>Gender</label><select data-f="gender">' +
        GENDERS.map(function (g) { return '<option value="' + g.slug + '"' + (s.gender === g.slug ? ' selected' : '') + '>' + g.name + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="row2">' +
        '<div class="fg"><label>Max products</label><input type="number" min="1" max="40" data-f="item_limit" value="' + esc(s.item_limit || 12) + '"></div>' +
        '<div class="fg"><label>Display order</label><input type="number" min="1" data-f="sort_order" value="' + esc(s.sort_order || (sections.length + 1)) + '"></div>' +
      '</div>' +
      '<div style="background:var(--bg2);border-radius:10px;padding:2px 10px;margin-bottom:6px"><div class="tgl-row"><label>Active</label><div class="tgl' + (s.active !== false ? ' on' : '') + '" data-tgl="active"><div class="tgl-k"></div></div></div></div>' +
      '<div class="form-btns"><button class="btn-p" data-a="save-sec">Save Section</button><button class="btn-s" data-a="cancel-sec">Cancel</button></div></div>';

    var typeSel = pane.querySelector('[data-f="type"]');
    var catWrap = pane.querySelector('[data-sec-cat]');
    var picker = new Pcx.CategoryPicker(pane.querySelector('[data-cp]'), { tree: tree });
    picker.setValue(s.category_id);
    secPicker = picker;

    function syncType() {
      var t = typeSel.value;
      catWrap.style.display = t === 'category' ? '' : 'none';
      pane.querySelector('[data-sec-vendor]').style.display = t === 'vendor' ? '' : 'none';
      pane.querySelector('[data-sec-gender]').style.display = t === 'gender' ? '' : 'none';
    }
    typeSel.addEventListener('change', syncType);
    syncType();
  }

  var secPicker = null;

  async function saveSec() {
    var pane = $('fwPane-sections');
    var title = pane.querySelector('[data-f="title"]').value.trim();
    var type = pane.querySelector('[data-f="type"]').value;
    if (!title) return toast('Title is required', true);
    var row = {
      title: title, type: type,
      category_id: type === 'category' ? (secPicker ? secPicker.getValue() : null) : null,
      vendor_id: type === 'vendor' ? (pane.querySelector('[data-f="vendor_id"]').value || null) : null,
      gender: type === 'gender' ? (pane.querySelector('[data-f="gender"]').value || null) : null,
      item_limit: parseInt(pane.querySelector('[data-f="item_limit"]').value, 10) || 12,
      sort_order: parseInt(pane.querySelector('[data-f="sort_order"]').value, 10) || 1,
      active: pane.querySelector('[data-tgl="active"]').classList.contains('on')
    };
    if (type === 'category' && row.category_id == null) return toast('Choose a category', true);
    if (type === 'vendor' && !row.vendor_id) return toast('Choose a seller', true);
    showLoad('Saving section...');
    var res = editingSec.id ? await sb.from('fashion_sections').update(row).eq('id', editingSec.id)
                            : await sb.from('fashion_sections').insert([row]);
    hideLoad();
    if (res.error) return toast('Save failed: ' + explain(res.error), true);
    toast(editingSec.id ? 'Section updated' : 'Section added');
    editingSec = null;
    await loadSections();
    renderSections();
  }

  async function toggleSec(id) {
    var s = sections.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!s) return;
    var res = await sb.from('fashion_sections').update({ active: s.active === false }).eq('id', s.id);
    if (res.error) return toast('Failed: ' + explain(res.error), true);
    await loadSections();
    renderSections();
  }

  function deleteSec(id) {
    confirm('Delete section', 'Remove this Fashion section?', async function () {
      showLoad('Deleting...');
      var res = await sb.from('fashion_sections').delete().eq('id', id);
      hideLoad();
      if (res.error) return toast('Delete failed: ' + explain(res.error), true);
      toast('Section deleted');
      await loadSections();
      renderSections();
    });
  }

  async function moveSec(id, dir) {
    var list = sections.slice();
    var i = list.findIndex(function (s) { return String(s.id) === String(id); });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var t = list[i]; list[i] = list[j]; list[j] = t;
    var changes = list.map(function (s, k) { return { id: s.id, sort_order: k + 1 }; });
    showLoad('Reordering...');
    var results = await Promise.all(changes.map(function (ch) { return sb.from('fashion_sections').update({ sort_order: ch.sort_order }).eq('id', ch.id); }));
    hideLoad();
    var bad = results.filter(function (r) { return r.error; })[0];
    if (bad) return toast(explain(bad.error), true);
    await loadSections();
    renderSections();
  }

  /* ================================================================ render + events */
  function render() {
    if (sub === 'genders') renderGenders();
    else if (sub === 'ads') renderAds();
    else if (sub === 'cats') renderCats();
    else if (sub === 'sections') renderSections();
  }

  document.getElementById('p-explore').addEventListener('click', async function (e) {
    var btn = e.target.closest ? e.target.closest('[data-a]') : null;
    if (!btn) return;
    var a = btn.dataset.a, id = btn.dataset.id;
    if (a === 'save-gender') saveGender(btn.dataset.slug);
    else if (a === 'clear-media') clearGenderMedia(btn.dataset.slug);
    else if (a === 'new-ad') { editingAd = { image_url: '' }; renderAds(); window.scrollTo(0, 0); }
    else if (a === 'edit-ad') { editingAd = JSON.parse(JSON.stringify(ads.filter(function (x) { return String(x.id) === String(id); })[0] || {})); renderAds(); window.scrollTo(0, 0); }
    else if (a === 'save-ad') saveAd();
    else if (a === 'cancel-ad') { editingAd = null; renderAds(); }
    else if (a === 'toggle-ad') toggleAd(id);
    else if (a === 'delete-ad') deleteAd(id);
    else if (a === 'toggle-cat') toggleCat(Number(id));
    else if (a === 'up-cat') moveCat(Number(id), -1);
    else if (a === 'down-cat') moveCat(Number(id), 1);
    else if (a === 'new-sec') { editingSec = { title: '', type: 'category', category_id: null, vendor_id: null, gender: 'women', item_limit: 12, active: true, sort_order: sections.length + 1 }; renderSections(); window.scrollTo(0, 0); }
    else if (a === 'edit-sec') { editingSec = JSON.parse(JSON.stringify(sections.filter(function (x) { return String(x.id) === String(id); })[0] || {})); renderSections(); window.scrollTo(0, 0); }
    else if (a === 'save-sec') saveSec();
    else if (a === 'cancel-sec') { editingSec = null; renderSections(); }
    else if (a === 'toggle-sec') toggleSec(id);
    else if (a === 'delete-sec') deleteSec(id);
    else if (a === 'up-sec') moveSec(id, -1);
    else if (a === 'down-sec') moveSec(id, 1);
  });

  /* toggles inside the fashion panel */
  document.getElementById('p-explore').addEventListener('click', function (e) {
    var tgl = e.target.closest ? e.target.closest('[data-tgl]') : null;
    if (tgl) tgl.classList.toggle('on');
  });
})();
