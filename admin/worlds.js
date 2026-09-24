/* Admin: Explore Marcato (Banners > Explore Marcato).
 *
 * One place to manage the whole world system:
 *
 *   Worlds list      add / edit / delete / enable-disable / reorder the Explore Marcato worlds, and upload each card's
 *                    image and GIF. The homepage cards come straight from this list (table `worlds`).
 *   World > Hero     the hero slides shown at the top of one world (table `world_heroes`).
 *   World > Display categories
 *                    the visual category cards INSIDE one world, 5 per row on mobile (table `world_display_categories`):
 *                    name, image, GIF, order, on/off, and which NORMAL marketplace categories each one opens
 *                    (table `world_category_links`). These are not the marketplace categories; that taxonomy is only read.
 *
 * The same screens work for every world (Food, Fashion, Beauty, ... and any world added later).
 * All media goes to the existing Supabase Storage bucket, folder `worlds/`, never into the database. GIFs are uploaded
 * untouched so they keep animating; big GIFs (over 6 MB) use a resumable upload.
 * Tables and policies: migration_explore_worlds.sql (root of repo).
 *
 * Every record is an item { uid, kind, saved, draft }: `draft` is what is on screen (kept when the screen re-draws, so
 * nothing typed or uploaded is lost until you Save), `saved` is what is in the database.
 *
 * Uses globals from admin/index.html: sb, toast, confirm, showLoad, hideLoad, uploadImage, BUCKET, SB_URL, SB_KEY.
 * Uses window.esc / safeUrl (data/safe.js), Pcx.MultiImagePicker, Pcx.Categories (data/categories.js).
 */
(function () {
  'use strict';

  var esc = window.esc || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var safeUrl = window.safeUrl || esc;
  var pane = function () { return document.getElementById('worldsPane'); };

  var TABLE = { world: 'worlds', hero: 'world_heroes', cat: 'world_display_categories' };
  var FIELDS = {
    world: ['title', 'slug', 'description', 'image_url', 'card_gif_url', 'is_active', 'sort_order'],
    hero: ['title', 'subtitle', 'image_url', 'gif_url', 'cta_type', 'cta_label', 'cta_value', 'is_active', 'sort_order'],
    cat: ['name', 'image_url', 'gif_url', 'is_active', 'sort_order']
  };
  var GIF_SLOT = { world: 'card_gif_url', hero: 'gif_url', cat: 'gif_url' };
  var FOLDER = { world: 'worlds', hero: 'worlds/hero', cat: 'worlds/categories' };
  var WORLD_COLS = 'slug,title,description,image_url,card_gif_url,is_active,sort_order';
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var RESUMABLE_OVER = 6 * 1024 * 1024;       // Supabase recommends the resumable protocol above 6 MB
  var GIF_MAX = 25 * 1024 * 1024;
  var TUS_SRC = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.1.0/dist/tus.min.js';

  var S = {
    loaded: false, err: '', needsMigration: false,
    view: 'list', slug: null,
    worlds: [], heroes: [], cats: [],
    heroOpen: false,
    catOptions: [], catById: {}, catsErr: '',
    uploading: 0
  };
  var uidN = 0, byUid = {};

  /* ------------------------------------------------------------------ helpers */
  function explain(m) {
    m = String(m || '');
    if (/relation .*(world|categor)|schema cache|does not exist|Could not find the (table|'[a-z_]+' column)/i.test(m)) return 'The Explore Marcato tables are missing or out of date. Run migration_explore_worlds.sql in the Supabase SQL editor.';
    if (/row-level security/i.test(m)) return 'Blocked by row-level security. Run migration_explore_worlds.sql and sign in with the admin Google account.';
    if (/duplicate key|already exists/i.test(m)) return 'That slug is already used by another world.';
    return m;
  }

  function uploadMsg(err) {
    var m = (err && err.message) || String(err);
    return /row-level security|policy/i.test(m) ? 'Upload blocked by the storage policy. Run migration_explore_worlds.sql in the Supabase SQL editor.' : m;
  }

  function slugify(t) { return window.Pcx && Pcx.Categories ? Pcx.Categories.slugify(t) : String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

  function blankDraft(kind, order) {
    if (kind === 'world') return { title: '', slug: '', description: '', image_url: '', card_gif_url: '', is_active: true, sort_order: order };
    if (kind === 'hero') return { title: '', subtitle: '', image_url: '', gif_url: '', cta_type: 'none', cta_label: '', cta_value: '', is_active: true, sort_order: order };
    return { name: '', image_url: '', gif_url: '', is_active: true, sort_order: order, catIds: [] };
  }

  function draftFromRow(kind, r) {
    var d = {};
    FIELDS[kind].forEach(function (f) {
      var v = r[f];
      d[f] = f === 'is_active' ? v !== false : f === 'sort_order' ? (v == null ? 0 : v) : f === 'cta_type' ? (v || 'none') : (v == null ? '' : v);
    });
    if (kind === 'cat') d.catIds = (r._catIds || []).slice();
    return d;
  }

  function newItem(kind, row, order) {
    var it = { uid: ++uidN, kind: kind, open: !row, saved: row || null, draft: row ? draftFromRow(kind, row) : blankDraft(kind, order || 1) };
    if (kind === 'cat') it.savedCatIds = row ? (row._catIds || []).slice() : [];
    byUid[it.uid] = it;
    return it;
  }

  function listFor(kind) { return kind === 'world' ? S.worlds : kind === 'hero' ? S.heroes : S.cats; }
  function nextOrder(list) { return list.reduce(function (m, it) { return Math.max(m, parseInt(it.draft.sort_order, 10) || 0); }, 0) + 1; }
  function keyOf(it) { return it.kind === 'world' ? { col: 'slug', val: it.saved.slug } : { col: 'id', val: it.saved.id }; }
  function sortList(list) {
    list.sort(function (a, b) {
      var d = (parseInt(a.draft.sort_order, 10) || 0) - (parseInt(b.draft.sort_order, 10) || 0);
      return d || (a.uid - b.uid);
    });
  }

  function mediaUrls(kind, row) {
    var out = [];
    ['image_url', 'card_gif_url', 'gif_url'].forEach(function (f) { if (row && row[f]) out.push(row[f]); });
    return out;
  }

  /* Only files this screen put in Storage (bucket folder worlds/) are ever removed. Best effort: a failed clean-up never blocks a save. */
  function pathOf(url) {
    var m = /\/storage\/v1\/object\/public\/[^/]+\/(worlds\/[^?#]+)/.exec(String(url || ''));
    return m ? decodeURIComponent(m[1]) : null;
  }
  async function removeMedia(urls) {
    var paths = (urls || []).map(pathOf).filter(Boolean);
    if (!paths.length) return;
    try { await sb.storage.from(BUCKET).remove(paths); } catch (e) { console.warn('media clean-up failed', e); }
  }

  /* ------------------------------------------------------------------ upload */
  var tusPromise = null;
  function loadTus() {
    if (window.tus) return Promise.resolve();
    if (!tusPromise) tusPromise = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = TUS_SRC; s.onload = res; s.onerror = function () { tusPromise = null; rej(new Error('Could not load the resumable-upload helper. Check your connection or use a GIF under 6 MB.')); };
      document.head.appendChild(s);
    });
    return tusPromise;
  }

  async function resumableUpload(file, folder, barId, progId) {
    var prog = document.getElementById(progId), bar = document.getElementById(barId);
    if (prog) { prog.classList.add('on'); if (bar) bar.style.width = '0%'; }
    try {
      await loadTus();
      var sess = (await sb.auth.getSession()).data.session;
      if (!sess) throw new Error('Your admin session expired. Sign in again.');
      var path = folder + '/' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.gif';
      await new Promise(function (resolve, reject) {
        var up = new window.tus.Upload(file, {
          endpoint: SB_URL.replace(/\/$/, '') + '/storage/v1/upload/resumable',
          retryDelays: [0, 3000, 5000, 10000, 20000],
          headers: { authorization: 'Bearer ' + sess.access_token, apikey: SB_KEY, 'x-upsert': 'false' },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          chunkSize: 6 * 1024 * 1024,
          metadata: { bucketName: BUCKET, objectName: path, contentType: 'image/gif', cacheControl: '31536000' },
          onError: reject,
          onProgress: function (sent, total) { if (bar) bar.style.width = Math.round(sent / total * 100) + '%'; },
          onSuccess: resolve
        });
        up.findPreviousUploads().then(function (prev) { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); }, function () { up.start(); });
      });
      if (prog) setTimeout(function () { prog.classList.remove('on'); }, 600);
      return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    } catch (e) {
      if (prog) prog.classList.remove('on');
      var m = (e && e.message) || String(e);
      throw new Error(/row-level security|policy|403|401/i.test(m) ? 'Upload blocked by the storage policy. Run migration_explore_worlds.sql in the Supabase SQL editor.' : m);
    }
  }

  /* PNG, JPG/JPEG, WEBP and GIF. GIFs are never re-drawn (that would freeze them on the first frame). */
  async function uploadWorldMedia(file, it, slot) {
    var type = String(file.type || '').toLowerCase();
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(type)) throw new Error('Use a PNG, JPG, WEBP or GIF file.');
    if (slot === 'gif' && type !== 'image/gif') throw new Error('This slot is for GIF files. Put pictures in the image slot.');
    var barId = 'wa-b-' + it.uid, progId = 'wa-p-' + it.uid, folder = FOLDER[it.kind];
    if (type === 'image/gif') {
      if (file.size > GIF_MAX) throw new Error('This GIF is over 25 MB. Compress it (about 480 px wide) and try again.');
      if (file.size > RESUMABLE_OVER) return resumableUpload(file, folder, barId, progId);
    }
    var keepAlpha = /png|webp/.test(type);   // a PNG/WEBP may have a transparent background: never flatten it to a black JPEG
    return uploadImage(file, folder, barId, progId, keepAlpha);
  }

  /* ------------------------------------------------------------------ load */
  async function loadWorlds() {
    var r = await sb.from('worlds').select(WORLD_COLS).order('sort_order', { ascending: true }).order('slug', { ascending: true });
    S.err = ''; S.needsMigration = false;
    if (r.error) { S.needsMigration = true; S.err = explain(r.error.message); S.worlds = []; return; }
    S.worlds = (r.data || []).map(function (row) { return newItem('world', row); });
  }

  async function loadCategories() {
    var r = await Pcx.Categories.fetchAll(sb, { includeInactive: true });
    S.catsErr = r.error ? r.error.message : '';
    S.catOptions = []; S.catById = {};
    if (r.error) return;
    var tree = new Pcx.Categories.Tree(r.rows);
    (function walk(list, depth) {
      list.forEach(function (c) {
        S.catOptions.push({ id: c.id, slug: c.slug, name: c.name, depth: depth, active: c.active });
        S.catById[String(c.id)] = c.id;
        walk(tree.children(c.id), depth + 1);
      });
    })(tree.roots, 0);
  }

  async function loadDetail() {
    S.err = '';
    var res = await Promise.all([
      sb.from('world_heroes').select('*').eq('world_slug', S.slug).order('sort_order', { ascending: true }).order('id', { ascending: true }),
      sb.from('world_display_categories').select('*').eq('world_slug', S.slug).order('sort_order', { ascending: true }).order('id', { ascending: true }),
      loadCategories()
    ]);
    var h = res[0], c = res[1];
    if (h.error || c.error) { S.err = explain((h.error || c.error).message); S.heroes = []; S.cats = []; return; }
    var ids = (c.data || []).map(function (x) { return x.id; }), links = [];
    if (ids.length) {
      var l = await sb.from('world_category_links').select('display_category_id,category_id').in('display_category_id', ids);
      if (l.error) { S.err = explain(l.error.message); } else links = l.data || [];
    }
    var by = {};
    links.forEach(function (x) { (by[x.display_category_id] = by[x.display_category_id] || []).push(x.category_id); });
    S.heroes = (h.data || []).map(function (r) { return newItem('hero', r); });
    S.cats = (c.data || []).map(function (r) { r._catIds = by[r.id] || []; return newItem('cat', r); });
  }

  /* ------------------------------------------------------------------ draw */
  function fg(label, inner, hint) {
    return '<div class="fg"><label>' + label + '</label>' + inner + (hint ? '<div class="ad-hint">' + hint + '</div>' : '') + '</div>';
  }
  function inp(f, val, ph, extra) {
    return '<input data-f="' + f + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '" ' + (extra || '') + '>';
  }
  function tglRow(it) {
    var on = it.draft.is_active;
    return '<div class="tgl-row"><label>Enabled</label><div class="tgl' + (on ? ' on' : '') + '" data-a="tgl" role="switch" aria-checked="' + on + '" tabindex="0"><div class="tgl-k"></div></div></div>';
  }
  function mediaFG(slot, label, hint) { return fg(label, '<div data-pk="' + slot + '"></div>', hint); }
  function progress(it) { return '<div class="uprog" id="wa-p-' + it.uid + '"><div class="uprog-bar" id="wa-b-' + it.uid + '" style="width:0%"></div></div>'; }

  function thumbOf(it) {
    var d = it.draft, url = d[GIF_SLOT[it.kind]] || d.image_url;      // the GIF, when there is one, so the preview moves
    var name = it.kind === 'cat' ? d.name : d.title;
    var u = url ? safeUrl(url) : '';
    return '<div class="wa-th' + (it.kind === 'cat' ? ' round' : '') + '">' + (u ? '<img src="' + u + '" alt="">' : esc(String(name || '?').charAt(0).toUpperCase())) + '</div>';
  }

  function pill(on) { return '<span class="wa-pill' + (on ? '' : ' off') + '">' + (on ? 'Enabled' : 'Hidden') + '</span>'; }

  function headHTML(it) {
    var d = it.draft, list = listFor(it.kind), i = list.indexOf(it), saved = !!it.saved;
    var title, meta;
    if (it.kind === 'world') {
      title = d.title || 'New world';
      meta = '<span>/' + esc(d.slug || slugify(d.title) || '...') + '</span>' + pill(d.is_active);
    } else if (it.kind === 'hero') {
      title = d.title || 'Hero slide ' + (i + 1);
      meta = pill(d.is_active) + (d.image_url || d.gif_url ? '' : '<span class="wa-pill warn">No media</span>');
    } else {
      title = d.name || 'New category';
      meta = pill(d.is_active) + (d.catIds.length ? '<span>' + d.catIds.length + ' linked</span>' : '<span class="wa-pill warn">Not linked</span>');
    }
    return '<div class="wa-hd" data-a="toggle">' + thumbOf(it) +
      '<div class="wa-main"><div class="wa-name">' + esc(title) + '</div><div class="wa-meta">' + meta + '</div></div>' +
      '<div class="wa-acts">' +
        (saved ? '<button type="button" data-a="up" aria-label="Move up"' + (i <= 0 ? ' disabled' : '') + '>&#9650;</button><button type="button" data-a="down" aria-label="Move down"' + (i >= list.length - 1 ? ' disabled' : '') + '>&#9660;</button>' : '') +
        '<button type="button" data-a="toggle" aria-label="' + (it.open ? 'Close' : 'Edit') + '">' + (it.open ? 'Close' : 'Edit') + '</button>' +
      '</div></div>';
  }

  function catSelectHTML(val) {
    return '<select data-f="cta_value"><option value="">Choose a category</option>' + S.catOptions.map(function (o) {
      return '<option value="' + esc(o.slug) + '"' + (o.slug === val ? ' selected' : '') + '>' + esc(new Array(o.depth + 1).join('\u2014 ') + o.name) + '</option>';
    }).join('') + '</select>';
  }

  function linksHTML(it) {
    if (S.catsErr) return '<div class="wa-err">Could not load the marketplace categories: ' + esc(S.catsErr) + '</div>';
    if (!S.catOptions.length) return '<div class="ad-hint">There are no marketplace categories yet. Create some in Admin &rsaquo; Categories, then link them here.</div>';
    var sel = {};
    it.draft.catIds.forEach(function (id) { sel[String(id)] = 1; });
    return '<div class="wa-links"><input type="search" data-a-search placeholder="Search categories" aria-label="Search categories">' +
      '<div class="wa-llist">' + S.catOptions.map(function (o) {
        return '<label class="wa-lrow" style="padding-left:' + (12 + o.depth * 16) + 'px" data-name="' + esc(o.name.toLowerCase()) + '">' +
          '<input type="checkbox" data-cid="' + esc(o.id) + '"' + (sel[String(o.id)] ? ' checked' : '') + '> ' + esc(o.name) + (o.active ? '' : ' <span class="wa-pill off">Hidden</span>') + '</label>';
      }).join('') + '</div></div>' +
      '<div class="wa-lcount">' + it.draft.catIds.length + ' selected</div>';
  }

  function bodyHTML(it) {
    var d = it.draft, saved = !!it.saved, out = '';
    if (it.kind === 'world') {
      out += fg('Title', inp('title', d.title, 'e.g. Food'));
      out += fg('Slug', inp('slug', d.slug, 'auto from title', 'autocapitalize="off" autocorrect="off" spellcheck="false"'), saved ? 'The page link is #world=slug. Changing the slug changes that link.' : 'Lower-case letters, numbers and dashes. Leave empty to build it from the title.');
      out += fg('Description', '<textarea data-f="description" placeholder="Shown under the title on the homepage card">' + esc(d.description) + '</textarea>');
      out += fg('Display order', inp('sort_order', d.sort_order, '1', 'inputmode="numeric"'), 'Smaller numbers show first. The up and down buttons change this too.');
      out += tglRow(it);
      out += mediaFG('image', 'Card image', 'Portrait works best (about 3:4). PNG, JPG or WEBP. Tap the \u00d7 to replace it.');
      out += mediaFG('gif', 'Card GIF (optional)', 'Plays on top of the image. Under 6 MB loads fastest; up to 25 MB works.');
    } else if (it.kind === 'hero') {
      out += fg('Title (optional)', inp('title', d.title, 'Big text on the slide'));
      out += fg('Subtitle (optional)', inp('subtitle', d.subtitle, 'Smaller text under the title'));
      out += mediaFG('image', 'Hero image', 'Wide works best (about 16:9). PNG, JPG or WEBP.');
      out += mediaFG('gif', 'Hero GIF (optional)', 'Plays on top of the image.');
      out += fg('Button (optional)', '<select data-f="cta_type"><option value="none"' + (d.cta_type === 'none' ? ' selected' : '') + '>No button</option><option value="category"' + (d.cta_type === 'category' ? ' selected' : '') + '>Opens a marketplace category</option><option value="link"' + (d.cta_type === 'link' ? ' selected' : '') + '>Opens a link</option></select>');
      if (d.cta_type !== 'none') {
        out += fg('Button text', inp('cta_label', d.cta_label, 'e.g. Shop now'));
        out += d.cta_type === 'category'
          ? fg('Category', catSelectHTML(d.cta_value))
          : fg('Link', inp('cta_value', d.cta_value, 'https://... or #world=fashion', 'autocapitalize="off" autocorrect="off" spellcheck="false"'), 'A web address, or an in-app page such as #world=fashion.');
      }
      out += fg('Display order', inp('sort_order', d.sort_order, '1', 'inputmode="numeric"'));
      out += tglRow(it);
    } else {
      out += fg('Category name', inp('name', d.name, 'e.g. Rice'));
      out += mediaFG('image', 'Image', 'Square works best; it is shown round. PNG, JPG or WEBP (a transparent PNG keeps its transparency).');
      out += mediaFG('gif', 'GIF (optional)', 'Plays on top of the image.');
      out += fg('Opens products from', linksHTML(it), 'Tick the marketplace categories whose products this card should show. Ticking a category includes everything under it.');
      out += fg('Display order', inp('sort_order', d.sort_order, '1', 'inputmode="numeric"'));
      out += tglRow(it);
    }
    out += progress(it);
    out += '<div class="form-btns"><button type="button" class="btn-p" data-a="save">' + (saved ? 'Save' : 'Add') + '</button>';
    if (it.kind === 'world' && saved) out += '<button type="button" class="btn-s" data-a="manage">Hero &amp; display categories</button>';
    out += '<button type="button" class="btn-d" data-a="del">' + (saved ? 'Delete' : 'Cancel') + '</button></div>';
    return '<div class="wa-body">' + out + '</div>';
  }

  function cardHTML(it) {
    return '<div class="wa-card' + (it.draft.is_active ? '' : ' off') + '" data-key="' + it.uid + '">' + headHTML(it) + (it.open ? bodyHTML(it) : '') + '</div>';
  }

  function migrationNotice() {
    return '<div class="wa-err">' + esc(S.err || 'Run migration_explore_worlds.sql in the Supabase SQL editor, then reopen this tab.') + '</div>';
  }

  function listHTML() {
    return '<div class="wa-bar"><span class="pt">Explore Marcato</span>' + (S.needsMigration ? '' : '<button type="button" class="btn-p" data-a="add-world">+ Add world</button>') + '</div>' +
      '<div class="wa-note">The destination cards on the homepage, right under the hero. Add, edit, hide, remove and re-order them here; the homepage follows this list. Tap a world to edit its card, or open <b>Hero &amp; display categories</b> to build what is inside it.</div>' +
      (S.needsMigration ? migrationNotice() :
        (S.worlds.length ? S.worlds.map(cardHTML).join('') : '<div class="wa-empty">No worlds yet. Tap <b>+ Add world</b> to create the first one.</div>'));
  }

  function detailHTML() {
    var w = null;
    S.worlds.forEach(function (x) { if (x.saved && x.saved.slug === S.slug) w = x; });
    var name = w ? (w.saved.title || w.saved.slug) : S.slug, up = String(name).toUpperCase();
    var heroCount = S.heroes.length;
    return '<div class="wa-crumb"><button type="button" class="btn-s" data-a="back">&lsaquo; Worlds</button><span class="pt">' + esc(name) + '</span></div>' +
      '<div class="wa-slug">/' + esc(S.slug) + ' &middot; ' + (w && w.saved.is_active ? 'shown on the homepage' : 'hidden from the homepage') + '</div>' +
      (S.err ? '<div class="wa-err">' + esc(S.err) + '</div>' : '') +
      '<div class="wa-sec"><h3>' + esc(up) + ' HERO</h3><button type="button" class="btn-s" data-a="hero-toggle">' + (S.heroOpen ? 'Close' : 'Manage Hero') + '</button></div>' +
      (S.heroOpen
        ? '<div class="wa-note">Slides at the top of the ' + esc(name) + ' page. With more than one, they swipe and slide on their own.</div>' +
          '<div class="form-btns" style="margin:0 0 10px"><button type="button" class="btn-p" data-a="add-hero">+ Add slide</button></div>' +
          (heroCount ? S.heroes.map(cardHTML).join('') : '<div class="wa-empty">No hero yet. The ' + esc(name) + ' page opens without one until you add a slide.</div>')
        : '<div class="wa-note">' + (heroCount ? heroCount + ' slide' + (heroCount === 1 ? '' : 's') : 'No slides yet') + '.</div>') +
      '<div class="wa-sec"><h3>' + esc(up) + ' DISPLAY CATEGORIES</h3><button type="button" class="btn-p" data-a="add-cat">+ Add Category</button></div>' +
      '<div class="wa-note">The round cards under the hero, 5 per row on a phone. Each opens the products of the marketplace categories you link it to. You upload their pictures and GIFs here, not in Admin &rsaquo; Categories.</div>' +
      (S.cats.length ? S.cats.map(cardHTML).join('') : '<div class="wa-empty">No display categories yet. Tap <b>+ Add Category</b>.</div>');
  }

  function render() {
    var p = pane(); if (!p) return;
    var y = window.scrollY;
    p.innerHTML = S.view === 'list' ? listHTML() : detailHTML();
    initPickers();
    window.scrollTo(0, y);
  }

  function initPickers() {
    pane().querySelectorAll('[data-key]').forEach(function (card) {
      var it = byUid[card.getAttribute('data-key')];
      if (!it || !it.open) return;
      card.querySelectorAll('[data-pk]').forEach(function (el) {
        var slot = el.getAttribute('data-pk'), field = slot === 'gif' ? GIF_SLOT[it.kind] : 'image_url';
        var picker = new Pcx.MultiImagePicker(el, {
          max: 1, label: slot === 'gif' ? 'Add GIF' : 'Add image',
          upload: async function (file) {
            S.uploading++;
            try { return await uploadWorldMedia(file, it, slot); } finally { S.uploading--; }
          },
          onChange: function (urls) { it.draft[field] = urls[0] || ''; },
          onError: function (err) { toast(uploadMsg(err), true); }
        });
        picker.setImages(it.draft[field] ? [it.draft[field]] : []);
      });
    });
  }

  /* ------------------------------------------------------------------ actions */
  function validate(it, p) {
    if (it.kind === 'world') {
      if (!p.title) return 'Give the world a title';
      var slug = p.slug || slugify(p.title);
      if (!SLUG_RE.test(slug)) return 'The slug can only have lower-case letters, numbers and single dashes';
      p.slug = slug;
    } else if (it.kind === 'hero') {
      if (!p.image_url && !p.gif_url) return 'A hero slide needs an image or a GIF';
      if (p.cta_type !== 'none') {
        if (!p.cta_label) return 'Give the button some text, or choose "No button"';
        if (!p.cta_value) return p.cta_type === 'category' ? 'Choose the category the button opens' : 'Enter the link the button opens';
        if (p.cta_type === 'link' && !/^#[a-z0-9=&_\-\/.]+$/i.test(p.cta_value) && !(/^(https?:\/\/|\/)/i.test(p.cta_value) && safeUrl(p.cta_value))) return 'The link must start with https:// or be an in-app page like #world=fashion';
      } else { p.cta_label = null; p.cta_value = null; }
    } else if (!p.name) return 'Give the category a name';
    return '';
  }

  function payloadOf(it) {
    var d = it.draft, out = {};
    FIELDS[it.kind].forEach(function (f) {
      var v = d[f];
      if (f === 'is_active') out[f] = !!v;
      else if (f === 'sort_order') out[f] = parseInt(v, 10) || 0;
      else if (f === 'cta_type') out[f] = v || 'none';
      else { v = String(v == null ? '' : v).trim(); out[f] = v === '' ? null : v; }
    });
    return out;
  }

  async function syncLinks(displayId, before, after) {
    var b = {}, a = {};
    before.forEach(function (id) { b[String(id)] = id; });
    after.forEach(function (id) { a[String(id)] = id; });
    var add = Object.keys(a).filter(function (k) { return !b[k]; }).map(function (k) { return a[k]; });
    var del = Object.keys(b).filter(function (k) { return !a[k]; }).map(function (k) { return b[k]; });
    if (del.length) {
      var d = await sb.from('world_category_links').delete().eq('display_category_id', displayId).in('category_id', del);
      if (d.error) return d.error;
    }
    if (add.length) {
      var i = await sb.from('world_category_links').insert(add.map(function (id) { return { display_category_id: displayId, category_id: id }; }));
      if (i.error) return i.error;
    }
    return null;
  }

  async function save(it) {
    if (S.uploading) { toast('Wait for the upload to finish', true); return; }
    var p = payloadOf(it), bad = validate(it, p);
    if (bad) { toast(bad, true); return; }
    p.updated_at = new Date().toISOString();
    showLoad('Saving...');
    var res;
    if (!it.saved) {
      if (it.kind !== 'world') p.world_slug = S.slug;
      res = await sb.from(TABLE[it.kind]).insert(p).select().single();
    } else {
      var k = keyOf(it);
      res = await sb.from(TABLE[it.kind]).update(p).eq(k.col, k.val).select().single();
    }
    if (res.error) { hideLoad(); toast('Save failed: ' + explain(res.error.message), true); console.error(res.error); return; }
    var row = res.data, old = it.saved, linkErr = null;

    if (it.kind === 'cat') {
      linkErr = await syncLinks(row.id, it.savedCatIds || [], it.draft.catIds);
      if (!linkErr) { it.savedCatIds = it.draft.catIds.slice(); row._catIds = it.savedCatIds.slice(); }
      else row._catIds = (it.savedCatIds || []).slice();
    }
    hideLoad();

    var keep = mediaUrls(it.kind, row);
    if (old) removeMedia(mediaUrls(it.kind, old).filter(function (u) { return keep.indexOf(u) < 0; }));

    it.saved = row; it.draft = draftFromRow(it.kind, row); it.open = false;
    sortList(listFor(it.kind));
    render();
    if (linkErr) { toast('Saved, but the linked categories were not: ' + explain(linkErr.message), true); console.error(linkErr); }
    else toast(it.kind === 'world' ? 'World saved' : it.kind === 'hero' ? 'Hero slide saved' : 'Category saved');
  }

  function removeItem(it) {
    var list = listFor(it.kind), i = list.indexOf(it);
    if (i >= 0) list.splice(i, 1);
    delete byUid[it.uid];
  }

  function del(it) {
    if (!it.saved) { removeItem(it); removeMedia(mediaUrls(it.kind, it.draft)); render(); return; }   // never saved: drop it and its uploads
    var what = it.kind === 'world' ? 'world' : it.kind === 'hero' ? 'hero slide' : 'display category';
    var extra = it.kind === 'world' ? ' Its hero slides and display categories are deleted with it, and it disappears from the homepage.' : '';
    confirm('Delete this ' + what + '?', 'This cannot be undone.' + extra, async function () {
      showLoad('Deleting...');
      var urls = mediaUrls(it.kind, it.saved);
      if (it.kind === 'world') {
        var kids = await Promise.all([
          sb.from('world_heroes').select('image_url,gif_url').eq('world_slug', it.saved.slug),
          sb.from('world_display_categories').select('image_url,gif_url').eq('world_slug', it.saved.slug)
        ]);
        kids.forEach(function (r) { (r.data || []).forEach(function (row) { urls = urls.concat(mediaUrls('hero', row)); }); });
      }
      var k = keyOf(it);
      var r = await sb.from(TABLE[it.kind]).delete().eq(k.col, k.val);
      hideLoad();
      if (r.error) { toast('Delete failed: ' + explain(r.error.message), true); console.error(r.error); return; }
      removeMedia(urls);
      removeItem(it);
      render();
      toast('Deleted');
    });
  }

  async function move(it, dir) {
    var list = listFor(it.kind), i = list.indexOf(it), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    list.splice(i, 1); list.splice(j, 0, it);
    var jobs = [];
    list.forEach(function (x, idx) {
      var n = idx + 1;
      x.draft.sort_order = n;
      if (x.saved && x.saved.sort_order !== n) {
        var k = keyOf(x);
        jobs.push(sb.from(TABLE[x.kind]).update({ sort_order: n, updated_at: new Date().toISOString() }).eq(k.col, k.val).then(function (r) {
          if (r.error) throw r.error;
          x.saved.sort_order = n;
        }));
      }
    });
    render();
    try { await Promise.all(jobs); } catch (e) { toast('Could not save the new order: ' + explain(e.message), true); console.error(e); }
  }

  async function openWorld(slug) {
    S.view = 'world'; S.slug = slug; S.heroOpen = false;
    pane().innerHTML = '<div class="ad-empty">Loading...</div>';
    try { await loadDetail(); } catch (e) { S.err = explain(e.message); S.heroes = []; S.cats = []; }
    render();
    window.scrollTo(0, 0);
  }

  function backToList() {
    S.view = 'list'; S.slug = null; S.err = S.needsMigration ? S.err : '';
    render();
    window.scrollTo(0, 0);
  }

  function addItem(kind) {
    var list = listFor(kind);
    var it = newItem(kind, null, nextOrder(list));
    list.unshift(it);
    render();
    var card = pane().querySelector('[data-key="' + it.uid + '"]');
    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
  }

  /* ------------------------------------------------------------------ events */
  function itemOf(el) {
    var card = el.closest('[data-key]');
    return card ? byUid[card.getAttribute('data-key')] : null;
  }

  function onClick(e) {
    var b = e.target.closest('[data-a]');
    if (!b || !pane().contains(b)) return;
    var a = b.getAttribute('data-a'), it = itemOf(b);
    if (a === 'add-world') return addItem('world');
    if (a === 'add-hero') return addItem('hero');
    if (a === 'add-cat') return addItem('cat');
    if (a === 'back') return backToList();
    if (a === 'hero-toggle') { S.heroOpen = !S.heroOpen; return render(); }
    if (!it) return;
    if (a === 'toggle') { it.open = !it.open; return render(); }
    if (a === 'up') return move(it, -1);
    if (a === 'down') return move(it, 1);
    if (a === 'tgl') { it.draft.is_active = !it.draft.is_active; return render(); }
    if (a === 'save') return save(it);
    if (a === 'del') return del(it);
    if (a === 'manage') {
      if (!it.saved) return;
      return openWorld(it.saved.slug);
    }
  }

  function onInput(e) {
    var t = e.target, it = itemOf(t);
    if (t.hasAttribute && t.hasAttribute('data-a-search')) {
      var q = t.value.trim().toLowerCase();
      t.closest('.wa-links').querySelectorAll('.wa-lrow').forEach(function (r) { r.hidden = !!q && r.getAttribute('data-name').indexOf(q) < 0; });
      return;
    }
    if (!it) return;
    var cid = t.getAttribute('data-cid');
    if (cid != null) {
      var id = S.catById[cid], ids = it.draft.catIds.filter(function (x) { return String(x) !== cid; });
      if (t.checked) ids.push(id);
      it.draft.catIds = ids;
      var cnt = t.closest('.fg').querySelector('.wa-lcount');
      if (cnt) cnt.textContent = ids.length + ' selected';
      return;
    }
    var f = t.getAttribute('data-f');
    if (!f) return;
    it.draft[f] = t.value;
    if (f === 'cta_type' && e.type === 'change') { it.draft.cta_value = ''; render(); }
  }

  function bind() {
    var p = pane();
    if (p.dataset.bound) return;
    p.dataset.bound = '1';
    p.addEventListener('click', onClick);
    p.addEventListener('input', onInput);
    p.addEventListener('change', onInput);
    p.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('data-a') === 'tgl') { e.preventDefault(); onClick(e); }
    });
  }

  window.WorldsAdmin = {
    open: async function () {
      bind();
      if (!S.loaded) {
        pane().innerHTML = '<div class="ad-empty">Loading...</div>';
        try { await loadWorlds(); } catch (e) { S.needsMigration = true; S.err = explain(e.message); }
        S.loaded = true;
      }
      if (S.view === 'world' && S.slug) { render(); return; }
      render();
    },
    /* exposed for tests */
    _state: S
  };
})();
