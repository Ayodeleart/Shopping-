/* Admin: bulk image editor for categories and subcategories (opened from admin/categories.js, "Edit all images").
 *
 * Every category / subcategory is listed with its own preview, its own file picker and its own remove button.
 * Choosing a file only stores it in memory (keyed by that item's id); nothing is uploaded until "Save All Changes".
 * Saving walks the pending items one by one: upload the file to the existing storage bucket (a fresh unique path per
 * upload, via uploadImage), then update `categories.image_url` for THAT id only, and check the database really
 * changed a row. Items that fail keep their selected file and their old image, and stay pending for a retry. An
 * upload that succeeded but whose database update failed is remembered, so a retry does not upload it twice.
 *
 * Uses the existing `image_url` column and storage bucket: no migration. The optional GIF (gif_url) is not touched here.
 *
 * "Remove background from every upload" is ONE toggle for the whole batch (on by default): when a pending
 * item is a freshly picked photo (not a removal), Save All Changes uploads it as usual and then runs the SAME
 * paid, server-side cutout Beauty and Home & Decor products already use (removeBgServer -> POST /api/remove-bg,
 * remove.bg via REMOVE_BG_API_KEY in the Vercel env, admin-only, key never reaches the browser) -- a higher-
 * quality cutout than the free in-browser one, with the source-hash cache /api/remove-bg already keeps, so the
 * exact same photo is never billed twice. If the service is unavailable or not configured, the plain uploaded
 * photo is kept and used instead -- never blocks the batch. Already-transparent uploads are unaffected either way.
 *
 * API (used by admin/categories.js and admin/index.html):
 *   CatImages.open({ root, tree, upload(file) -> url, reload() -> tree, explain(err), onClose() })
 *   CatImages.refresh(tree)     re-render with a new tree, keeping pending changes
 *   CatImages.isOpen(), CatImages.hasPending(), CatImages.guard(proceed)  (asks before dropping pending changes)
 * Uses globals: sb, toast, confirm, safeUrl, removeBgServer; Pcx.Categories.
 */
(function (global) {
  'use strict';

  var C = global.Pcx.Categories, esc = C.esc;
  var opts = null, tree = null, root = null;
  var st = { scope: 'cats', filter: '', pending: {}, saving: false, progress: null, failed: {}, savedNow: {}, summary: '', removeBg: true };

  /* ------------------------------------------------------------ helpers */
  function el(sel) { return root ? root.querySelector(sel) : null; }
  function isOpen() { return !!opts; }
  function hasPending() { return Object.keys(st.pending).length > 0; }
  function ask(title, msg, cb) { if (typeof confirm === 'function' && confirm.length >= 3) confirm(title, msg, cb); else cb(); }   // the page's own confirm(title, msg, cb), not the browser's

  function isRoot(c) { return c.parentId == null; }
  function inScope(c, scope) { return scope === 'cats' ? isRoot(c) : !isRoot(c); }

  function pendingIds(scope) {
    return Object.keys(st.pending).map(Number).filter(function (id) { var c = tree.byId[id]; return c && inScope(c, scope); });
  }

  /* what to show, in order: categories = the main ones; subcategories = grouped under their main category */
  function entries(scope, q) {
    var out = [], hit = function (c) { return !q || c.name.toLowerCase().indexOf(q) >= 0 || c.slug.indexOf(q) >= 0; };
    if (scope === 'cats') {
      tree.roots.forEach(function (c) { if (hit(c)) out.push({ c: c, depth: 0 }); });
      return out;
    }
    tree.roots.forEach(function (r) {
      var rows = [];
      (function walk(list, depth) {
        list.forEach(function (c) { if (hit(c)) rows.push({ c: c, depth: depth }); walk(tree.children(c.id), depth + 1); });
      })(tree.children(r.id), 0);
      if (rows.length) { out.push({ group: r, count: tree.descendantIds(r.id).length }); out = out.concat(rows); }
    });
    return out;
  }

  /* ------------------------------------------------------------ rendering */
  function previewHTML(c) {
    var p = st.pending[c.id];
    if (p && p.file) return '<div class="cat-thumb s56"><img src="' + esc(safeUrl(p.blobUrl)) + '" alt="' + esc(c.name) + ' new image"></div>';
    if (p && p.remove) return C.thumb(tree, Object.assign({}, c, { imageUrl: '', placeholderPath: '', gifUrl: '' }), 's56');
    return C.thumb(tree, c, 's56');
  }

  function itemHTML(e) {
    var c = e.c, p = st.pending[c.id], err = st.failed[c.id];
    var has = !!c.imageUrl, cls = 'cim-item' + (p ? ' pending' : '') + (err ? ' failed' : '') + (st.savedNow[c.id] && !p ? ' saved' : '');
    var badge = err ? '<span class="cim-badge bad">Failed</span>'
      : p && p.uploadedUrl ? '<span class="cim-badge warn">Uploaded, not saved yet</span>'
      : p && p.file ? '<span class="cim-badge on">New image pending</span>'
      : p && p.remove ? '<span class="cim-badge on">Will be removed</span>'
      : st.savedNow[c.id] ? '<span class="cim-badge ok">Saved</span>'
      : has ? '' : '<span class="cim-badge none">No image</span>';
    var label = (p && p.file) || has ? 'Replace image' : 'Choose image';
    return '<div class="' + cls + '" data-item="' + esc(c.id) + '" style="margin-left:' + (e.depth ? Math.min(e.depth, 3) * 14 : 0) + 'px">' +
      '<div class="cim-prev">' + previewHTML(c) + '</div>' +
      '<div class="cim-main"><div class="cim-name">' + esc(c.name) + (c.active ? '' : ' <span class="pill">hidden</span>') + '</div>' +
        '<div class="cim-sub">' + esc(e.depth || !isRoot(c) ? tree.label(c.id) : c.slug) + '</div>' +
        '<div class="cim-btns">' + badge +
          '<label class="cim-btn" aria-label="' + esc(label + ' for ' + c.name) + '">' + label +
            '<input type="file" accept="image/*" data-cim-file="' + esc(c.id) + '"></label>' +
          (has && !(p && p.remove) ? '<button type="button" class="cim-btn" data-cim="rm" data-id="' + esc(c.id) + '">Remove</button>' : '') +
          (p ? '<button type="button" class="cim-btn ghost" data-cim="undo" data-id="' + esc(c.id) + '">Undo</button>' : '') +
        '</div>' +
        (err ? '<div class="cim-msg">' + esc(err) + (p && p.uploadedUrl ? ' The image was uploaded but not saved yet; retrying will not upload it again.' : '') + '</div>' : '') +
      '</div></div>';
  }

  function listHTML() {
    var q = st.filter.trim().toLowerCase(), list = entries(st.scope, q);
    if (!list.length) {
      return '<div class="no-items"><h3>' + (q ? 'No match' : st.scope === 'cats' ? 'No categories yet' : 'No subcategories yet') + '</h3></div>';
    }
    return list.map(function (e) {
      return e.group
        ? '<div class="cim-group"><span>' + esc(e.group.name) + '</span><small>' + e.count + ' sub' + (e.count === 1 ? '' : 's') + '</small></div>'
        : itemHTML(e);
    }).join('');
  }

  function barHTML() {
    var n = pendingIds(st.scope).length, total = Object.keys(st.pending).length, other = total - n;
    var pr = st.progress;
    return (pr ? '<div class="cim-prog"><div class="cim-prog-bar"><i style="width:' + Math.round(pr.done / pr.total * 100) + '%"></i></div>' +
        '<div class="cim-prog-txt">Saving ' + Math.min(pr.done + 1, pr.total) + ' of ' + pr.total + (pr.name ? ': ' + esc(pr.name) : '') + '...</div></div>' : '') +
      '<div class="cim-barrow"><div class="cim-count"><b>' + n + '</b> pending change' + (n === 1 ? '' : 's') +
        (other ? '<small>' + other + ' more in the other list</small>' : '') + '</div>' +
      '<button type="button" class="btn-s" data-cim="discard"' + (n && !st.saving ? '' : ' disabled') + '>Discard</button>' +
      '<button type="button" class="btn-p" data-cim="save"' + (n && !st.saving ? '' : ' disabled') + '>' + (st.saving ? 'Saving...' : 'Save All Changes') + '</button></div>';
  }

  function tabsHTML() {
    function tab(k, label) {
      var n = pendingIds(k).length, cnt = tree.list.filter(function (c) { return inScope(c, k); }).length;
      return '<button type="button" class="bsub-tab' + (st.scope === k ? ' on' : '') + '" data-cim="tab" data-scope="' + k + '">' + label +
        ' <span class="pill">' + cnt + '</span>' + (n ? '<span class="cim-dot">' + n + '</span>' : '') + '</button>';
    }
    return '<div class="cim-tabs">' + tab('cats', 'Categories') + tab('subs', 'Subcategories') + '</div>';
  }

  function render() {
    if (!root || !tree) return;
    root.innerHTML =
      '<div class="fcard cim-head"><div class="cim-top"><button type="button" class="btn-s" data-cim="back">\u2190 Back</button><h3>Edit all images</h3></div>' +
        tabsHTML() +
        '<div class="cat-note">Pick a different image for each item below, then tap <b>Save All Changes</b> once. Nothing is uploaded until you save. Items you do not touch keep their current image.</div>' +
        '<label class="cat-chk cim-rmbg"><input type="checkbox" id="cimRmBg"' + (st.removeBg ? ' checked' : '') + '><span>Remove background from every upload' +
          '<small>Runs each photo through remove.bg (the same paid cutout Beauty and Home &amp; Decor products use) after uploading \u2014 a photo already processed once is never billed again. Turn off if your images are already transparent.</small></span></label>' +
        '<input class="cat-search" id="cimFilter" type="search" placeholder="Filter by name" value="' + esc(st.filter) + '">' +
      '</div>' +
      (st.summary ? '<div class="cim-summary" id="cimSummary">' + st.summary + '</div>' : '') +
      '<div id="cimList">' + listHTML() + '</div>' +
      '<div class="cim-bar" id="cimBar">' + barHTML() + '</div>';
    syncLeaveGuard();
  }

  function refreshItem(id) {
    var c = tree.byId[id], node = el('[data-item="' + id + '"]');
    if (node && c) {
      var d = 0; if (!isRoot(c)) { d = -1; var x = c; while (x && x.parentId != null) { d++; x = tree.byId[x.parentId]; } }
      node.outerHTML = itemHTML({ c: c, depth: st.scope === 'subs' ? d : 0 });
    }
    refreshBar();
  }
  function refreshBar() {
    var b = el('#cimBar'); if (b) b.innerHTML = barHTML();
    var t = el('.cim-tabs'); if (t) t.outerHTML = tabsHTML();
    syncLeaveGuard();
  }

  /* ------------------------------------------------------------ leaving with unsaved changes */
  function onBeforeUnload(ev) { if (hasPending()) { ev.preventDefault(); ev.returnValue = ''; return ''; } }
  var guardOn = false;
  function syncLeaveGuard() {
    var want = hasPending();
    if (want && !guardOn) { global.addEventListener('beforeunload', onBeforeUnload); guardOn = true; }
    else if (!want && guardOn) { global.removeEventListener('beforeunload', onBeforeUnload); guardOn = false; }
  }
  function guard(proceed) {
    if (!isOpen() || !hasPending()) return proceed();
    ask('Unsaved image changes', 'You have ' + Object.keys(st.pending).length + ' image change(s) that are not saved yet. Leave and lose them?', function () { dropAll(); proceed(); });
  }

  /* ------------------------------------------------------------ pending changes (all in memory, per item id) */
  function freeBlob(p) { if (p && p.blobUrl && global.URL && URL.revokeObjectURL) { try { URL.revokeObjectURL(p.blobUrl); } catch (e) {} } }
  function dropOne(id) { freeBlob(st.pending[id]); delete st.pending[id]; delete st.failed[id]; }
  function dropAll() { Object.keys(st.pending).forEach(dropOne); st.failed = {}; syncLeaveGuard(); }

  function pick(id, file) {
    if (!tree.byId[id]) return;
    if (!file || !/^image\//.test(file.type || '')) { toast('Choose an image file', true); return; }
    freeBlob(st.pending[id]);
    st.pending[id] = { file: file, blobUrl: URL.createObjectURL(file), remove: false, uploadedUrl: null };
    delete st.failed[id]; delete st.savedNow[id];
    refreshItem(id);
  }
  function markRemove(id) {
    var c = tree.byId[id]; if (!c || !c.imageUrl) return;
    freeBlob(st.pending[id]);
    st.pending[id] = { file: null, blobUrl: null, remove: true, uploadedUrl: null };
    delete st.failed[id]; delete st.savedNow[id];
    refreshItem(id);
  }
  function undo(id) { dropOne(id); refreshItem(id); }

  /* ------------------------------------------------------------ save */
  async function saveAll() {
    if (st.saving) return;
    var ids = pendingIds(st.scope);
    if (!ids.length) return;
    st.saving = true; st.summary = ''; st.failed = {};
    var ok = 0, bad = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], p = st.pending[id], c = tree.byId[id];
      st.progress = { done: i, total: ids.length, name: c.name }; refreshBar();
      try {
        var url = null;
        if (!p.remove) {
          /* upload the original first (remove.bg needs a hosted, store-owned URL to fetch from) */
          if (!p.uploadedUrl) p.uploadedUrl = await opts.upload(p.file);   // fresh unique storage path each time
          url = p.uploadedUrl;
          /* p.cutoutUrl / p.cutoutSkip, once set, survive a retry so a failed DB update never re-runs (and re-bills) the cutout */
          if (st.removeBg && !p.cutoutUrl && !p.cutoutSkip) {
            st.progress = { done: i, total: ids.length, name: c.name + ' \u2014 removing background' }; refreshBar();
            try {
              var cut = await removeBgServer(p.uploadedUrl);
              if (cut) p.cutoutUrl = cut; else p.cutoutSkip = true;   // service unavailable / not configured: keep the plain upload
            } catch (e) { p.cutoutSkip = true; }
            st.progress = { done: i, total: ids.length, name: c.name }; refreshBar();
          }
          if (p.cutoutUrl) url = p.cutoutUrl;
        }
        /* Plain update + trust res.error, exactly like the already-working single-category editor's save().
           No .select() here: some Postgres/PostgREST setups don't return the updated row on an UPDATE unless
           a matching SELECT policy also passes, which made a real, successful save look like "0 rows changed"
           and get reported as a failure even though the image was saved. */
        var r = await sb.from('categories').update({ image_url: url }).eq('id', id);
        if (r.error) throw r.error;
        freeBlob(p); delete st.pending[id]; st.savedNow[id] = true; ok++;
      } catch (e) {
        st.failed[id] = opts.explain ? opts.explain(e) : ((e && e.message) || String(e));
        bad.push(c.name);
      }
    }
    st.progress = { done: ids.length, total: ids.length, name: '' };
    var refreshed = true;
    try { tree = await opts.reload(); } catch (e) { refreshed = false; }    // show what the database now really holds
    st.saving = false; st.progress = null;
    st.summary = '<b>' + ok + ' saved</b>' + (bad.length ? ', <b class="bad">' + bad.length + ' failed</b> (' + esc(bad.slice(0, 6).join(', ')) + (bad.length > 6 ? ' +' + (bad.length - 6) + ' more' : '') +
        '). Their images were kept and your selections are still here: tap Save All Changes to retry.' : '.') +
      (refreshed ? '' : ' Could not reload the list from the database; refresh to confirm.');
    render();
    if (bad.length) toast(ok + ' saved, ' + bad.length + ' failed. Tap Save All Changes to retry.', true);
    else toast(ok + ' image change' + (ok === 1 ? '' : 's') + ' saved');
    var s = el('#cimSummary'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' });
  }

  /* ------------------------------------------------------------ events (delegated on the root, added once per open) */
  function onClick(ev) {
    var b = ev.target.closest ? ev.target.closest('[data-cim]') : null;
    if (!b || !root.contains(b)) return;
    var a = b.getAttribute('data-cim'), id = b.getAttribute('data-id') ? Number(b.getAttribute('data-id')) : null;
    if (a === 'tab') { st.scope = b.getAttribute('data-scope'); st.summary = ''; render(); }
    else if (a === 'rm') markRemove(id);
    else if (a === 'undo') undo(id);
    else if (a === 'save') saveAll();
    else if (a === 'discard') ask('Discard changes', 'Discard the ' + pendingIds(st.scope).length + ' pending change(s) in this list?', function () { pendingIds(st.scope).forEach(dropOne); st.summary = ''; render(); });
    else if (a === 'back') { if (st.saving) return; guard(close); }
  }
  function onChange(ev) {
    var inp = ev.target;
    if (!inp || !inp.getAttribute || inp.getAttribute('data-cim-file') == null) return;
    var id = Number(inp.getAttribute('data-cim-file')), f = inp.files && inp.files[0];
    inp.value = '';                                   // the same file can be chosen again for another item
    if (f) pick(id, f);
  }
  function onInput(ev) {
    if (ev.target.id === 'cimRmBg') { st.removeBg = ev.target.checked; return; }
    if (ev.target.id !== 'cimFilter') return;
    st.filter = ev.target.value;
    var l = el('#cimList'); if (l) l.innerHTML = listHTML();
  }

  function open(o) {
    if (opts) detach();
    opts = o; tree = o.tree; root = o.root;
    st = { scope: 'cats', filter: '', pending: {}, saving: false, progress: null, failed: {}, savedNow: {}, summary: '', removeBg: true };
    root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onInput);
    render();
    if (root.scrollIntoView) root.scrollIntoView({ block: 'start' });
  }
  function detach() {
    if (root) { root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.removeEventListener('input', onInput); }
    dropAll(); opts = null; root = null; tree = null;
  }
  function close() { var cb = opts && opts.onClose; detach(); if (cb) cb(); }
  function refresh(t) { if (!opts) return; tree = t; render(); }

  global.CatImages = { open: open, close: close, refresh: refresh, isOpen: isOpen, hasPending: hasPending, guard: guard };
})(window);
