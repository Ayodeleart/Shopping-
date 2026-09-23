/* Admin: Explore Marcato (Banners > Explore Marcato).
 *
 * The 5 worlds themselves (Food, Fashion, Beauty, Home & Decor, Gifts) are fixed in code
 * (data/worlds.js) — name, tagline, gradient and icon are not editable here. This screen only
 * lets the admin upload/replace the photo or GIF shown on each card; until one is uploaded the
 * card falls back to its gradient + icon. Table: worlds (see migration_worlds.sql, root of repo).
 *
 * Uses globals from admin/index.html: sb, toast, showLoad, hideLoad, uploadImage.
 * Uses window.Worlds from data/worlds.js (also loaded by admin/index.html).
 */
(function () {
  'use strict';

  var rows = {}, loaded = false, tableMissing = false, uploading = 0;
  var pane = function () { return document.getElementById('worldsPane'); };

  function blankRow(slug) { return { slug: slug, image_url: '' }; }

  function explain(m) {
    if (/relation .*worlds|schema cache|does not exist|Could not find the table/i.test(m)) return 'The worlds table is missing. Run migration_worlds.sql in the Supabase SQL editor.';
    if (/row-level security/i.test(m)) return 'Blocked by row-level security. Run migration_worlds.sql and sign in with the admin Google account.';
    return m;
  }

  function uploadMsg(err) {
    var m = (err && err.message) || String(err);
    return /row-level security|policy/i.test(m) ? 'Upload blocked by the storage policy.' : m;
  }

  async function load() {
    var r = await sb.from('worlds').select('slug,image_url');
    tableMissing = !!r.error;
    rows = {};
    (r.data || []).forEach(function (row) { rows[row.slug] = row; });
    loaded = true;
  }

  function cardHTML(w) {
    var row = rows[w.slug] || blankRow(w.slug);
    return '<div class="fcard" data-world="' + w.slug + '">' +
      '<h3>' + w.name + '</h3>' +
      '<div class="ad-hint" style="margin-top:-6px">' + w.tagline + '</div>' +
      '<div class="fg"><label>Card image or GIF</label><div data-pk="' + w.slug + '"></div>' +
        '<div class="ad-hint">Portrait works best (roughly 3:4). Shown behind the card\u2019s title \u2014 no image yet falls back to a plain color card.</div></div>' +
      '<div class="form-btns"><button class="btn-p" data-a="save" data-slug="' + w.slug + '">Save</button></div>' +
      '<div class="uprog" id="worldProg-' + w.slug + '"><div class="uprog-bar" id="worldProgBar-' + w.slug + '" style="width:0%"></div></div>' +
    '</div>';
  }

  function render() {
    var worlds = window.Worlds.list();
    pane().innerHTML =
      '<div class="ph"><span class="pt">Explore Marcato</span></div>' +
      '<div class="ad-hint" style="margin:-4px 0 12px">The 5 destination cards on the homepage, right under the hero. Upload an image or GIF for each \u2014 the worlds themselves (name, tagline, order) aren\u2019t editable here.</div>' +
      (tableMissing ? '<div class="ad-empty">The worlds table is not set up yet. Run <b>migration_worlds.sql</b> in the Supabase SQL editor, then reopen this tab.</div>' : '') +
      (tableMissing ? '' : worlds.map(cardHTML).join(''));

    if (tableMissing) return;
    worlds.forEach(function (w) {
      var row = rows[w.slug] || blankRow(w.slug);
      var picker = new Pcx.MultiImagePicker(pane().querySelector('[data-pk="' + w.slug + '"]'), {
        max: 1, label: 'Add image',
        upload: async function (file) {
          uploading++;
          try { return await uploadImage(file, 'worlds', 'worldProgBar-' + w.slug, 'worldProg-' + w.slug); } finally { uploading--; }
        },
        onChange: function (urls) { row.image_url = urls[0] || ''; },
        onError: function (err) { toast(uploadMsg(err), true); }
      });
      picker.setImages(row.image_url ? [row.image_url] : []);
      row._picker = picker;
      rows[w.slug] = row;
    });
  }

  async function save(slug) {
    if (uploading) { toast('Wait for the upload to finish', true); return; }
    var row = rows[slug] || blankRow(slug);
    showLoad('Saving...');
    var res = await sb.from('worlds').upsert({ slug: slug, image_url: row.image_url || null, updated_at: new Date().toISOString() }, { onConflict: 'slug' });
    hideLoad();
    if (res.error) { toast('Save failed: ' + explain(res.error.message), true); console.error(res.error); return; }
    toast('Explore Marcato image updated');
  }

  function onClick(e) {
    var b = e.target.closest('[data-a="save"]');
    if (!b || !pane().contains(b)) return;
    save(b.dataset.slug);
  }

  function bind() {
    var p = pane();
    if (p.dataset.bound) return;
    p.dataset.bound = '1';
    p.addEventListener('click', onClick);
  }

  window.WorldsAdmin = {
    open: async function () {
      bind();
      if (!loaded) { pane().innerHTML = '<div class="ad-empty">Loading...</div>'; try { await load(); } catch (e) { tableMissing = true; } render(); }
      else render();
    }
  };
})();
