/* Admin: GIF tiles (Banners > Tiles). Any shape is accepted; the storefront shows them uncropped.
 *
 * A tile is a looping GIF (or image, any shape) with a caption, shown as a row under the hero banner, or inside the
 * product feed after N rows. Each tile opens what the admin tagged it with (see dest-picker.js): a brand's
 * products, everything 30% off, hand picked products, an ad page or a link. Table: tiles (the tiles SQL).
 *
 * Uses globals from admin/index.html: sb, toast, confirm, showLoad, hideLoad, uploadImage.
 */
(function () {
  'use strict';

  var tiles = [], cur = null, dest = null, loaded = false, tableMissing = false, uploading = 0;
  var pane = function () { return document.getElementById('tilesPane'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function blank() { return { id: null, image_url: '', caption: '', place: 'hero', after_rows: 5, sort_order: 1, active: true, target: null }; }

  function explain(m) {
    if (/relation .*tiles|schema cache|does not exist|Could not find the table/i.test(m)) return 'The tiles table is missing. Run the tiles SQL in the Supabase SQL editor.';
    if (/row-level security/i.test(m)) return 'Blocked by row-level security. Run the tiles SQL and sign in with the admin Google account.';
    return m;
  }

  function uploadMsg(err) {
    var m = (err && err.message) || String(err);
    return /row-level security|policy/i.test(m) ? 'Upload blocked by the storage policy. Run the ads and storage SQL in the Supabase SQL editor.' : m;
  }

  async function load() {
    var r = await sb.from('tiles').select('*').order('sort_order', { ascending: true });
    tableMissing = !!r.error;
    tiles = r.data || [];
    loaded = true;
  }

  function place(t) { return t.place === 'rows' ? 'After ' + t.after_rows + ' rows of products' : 'Under the hero'; }

  function itemHTML(t) {
    var live = t.active !== false, hasPage = t.target && ['brand', 'collection', 'products'].indexOf(t.target.type) !== -1;
    return '<div class="aditem">' +
      '<div class="aditem-img" style="width:64px;height:64px">' + (t.image_url ? '<img src="' + esc(t.image_url) + '" alt="" style="object-fit:contain">' : '') + '</div>' +
      '<div class="aditem-body"><div class="aditem-name">' + esc(t.caption || 'No caption') + '<span class="pill' + (live ? ' live' : '') + '">' + (live ? 'Live' : 'Paused') + '</span></div>' +
      '<div class="aditem-meta">' + esc(place(t)) + '</div><div class="aditem-meta">' + esc(DestPicker.describe(t.target)) + '</div></div>' +
      '<div class="aditem-acts">' +
        '<button class="abtn" data-a="edit" data-id="' + t.id + '">Edit</button>' +
        (hasPage ? '<button class="abtn" data-a="preview" data-id="' + t.id + '">Preview</button>' : '') +
        '<button class="abtn" data-a="toggle" data-id="' + t.id + '">' + (live ? 'Pause' : 'Resume') + '</button>' +
        '<button class="abtn danger" data-a="delete" data-id="' + t.id + '">Delete</button>' +
      '</div></div>';
  }

  function renderList() {
    cur = null; dest = null;
    pane().innerHTML =
      '<div class="ph"><span class="pt">GIF Tiles</span><button class="abtn solid" data-a="new">+ New Tile</button></div>' +
      '<div class="ad-hint" style="margin:-4px 0 12px">Tiles (looping GIFs or images) that sit under the hero banner (or inside the product feed). Each one opens the brand or the products you tag it with.</div>' +
      (tableMissing ? '<div class="ad-empty">The tiles table is not set up yet. Run <b>the tiles SQL</b> in the Supabase SQL editor, then reopen this tab.</div>' : '') +
      (tiles.length ? tiles.map(itemHTML).join('') : (tableMissing ? '' : '<div class="ad-empty">No tiles yet. Add a GIF such as "30% off" and tag it to the products it should open.</div>'));
  }

  function renderForm() {
    var c = cur;
    pane().innerHTML =
      '<div class="fcard" id="tileForm"><h3>' + (c.id ? 'Edit Tile' : 'New Tile') + '</h3>' +
      '<div class="fg"><label>GIF or image</label><div data-pk></div>' +
        '<div class="ad-hint">Looping GIFs work best, under 4 MB. Any shape is accepted and shown uncropped, so you can see how it looks before deciding whether it should be square.</div></div>' +
      '<div class="fg"><label>Caption</label><input type="text" data-f="caption" maxlength="40" placeholder="e.g. Buy More. Save More" value="' + esc(c.caption) + '"></div>' +
      '<div data-dest></div>' +
      '<div class="fg"><label>Where to show it</label><select data-f="place" data-re="1">' +
        '<option value="hero"' + (c.place === 'hero' ? ' selected' : '') + '>Under the hero banner</option>' +
        '<option value="rows"' + (c.place === 'rows' ? ' selected' : '') + '>Inside the product feed</option></select></div>' +
      (c.place === 'rows' ? '<div class="fg"><label>Show after (rows of products)</label><input type="number" min="1" data-f="after_rows" value="' + esc(c.after_rows) + '"></div>' : '') +
      '<div class="ad-hint" style="margin:-4px 0 12px">Tiles in the same place share one row: four fit the screen, more slide sideways.</div>' +
      '<div class="fg"><label>Order</label><input type="number" min="1" data-f="sort_order" value="' + esc(c.sort_order) + '"></div>' +
      '<div style="background:var(--bg2);border-radius:10px;padding:2px 10px;margin-bottom:6px"><div class="tgl-row"><label>Active (visible to shoppers)</label><div class="tgl' + (c.active ? ' on' : '') + '" data-tgl="active"><div class="tgl-k"></div></div></div></div>' +
      '<div class="form-btns" style="margin-top:14px"><button class="btn-p" data-a="save">Save Tile</button><button class="btn-s" data-a="cancel">Cancel</button></div>' +
      '<div class="uprog" id="tileProg"><div class="uprog-bar" id="tileProgBar" style="width:0%"></div></div></div>';

    var picker = new Pcx.MultiImagePicker(pane().querySelector('[data-pk]'), {
      max: 1, label: 'Add GIF',
      upload: async function (file) {
        uploading++;
        try { return await uploadImage(file, 'tiles', 'tileProgBar', 'tileProg'); } finally { uploading--; }
      },
      onChange: function (urls) { cur.image_url = urls[0] || ''; },
      onError: function (err) { toast(uploadMsg(err), true); }
    });
    picker.setImages(c.image_url ? [c.image_url] : []);
    dest = DestPicker.mount(pane().querySelector('[data-dest]'));
    dest.write(c.target);
  }

  async function save() {
    if (uploading) { toast('Wait for the upload to finish', true); return; }
    if (!cur.image_url) { toast('Add a GIF or image first', true); return; }
    var target;
    try { target = dest.read(); } catch (e) { toast(e.message, true); return; }
    var row = {
      image_url: cur.image_url, caption: (cur.caption || '').trim() || null, target: target,
      place: cur.place === 'rows' ? 'rows' : 'hero', after_rows: Math.max(1, parseInt(cur.after_rows, 10) || 5),
      sort_order: parseInt(cur.sort_order, 10) || 1, active: !!cur.active
    };
    showLoad('Saving tile...');
    var res = await (cur.id ? sb.from('tiles').update(row).eq('id', cur.id) : sb.from('tiles').insert([row]));
    hideLoad();
    if (res.error) { toast('Save failed: ' + explain(res.error.message), true); console.error(res.error); return; }
    toast(cur.id ? 'Tile updated' : 'Tile added');
    await load(); renderList();
  }

  function onClick(e) {
    var tg = e.target.closest('[data-tgl]');
    if (tg && cur && pane().contains(tg)) { tg.classList.toggle('on'); cur[tg.dataset.tgl] = tg.classList.contains('on'); return; }
    var b = e.target.closest('[data-a]');
    if (!b || !pane().contains(b)) return;
    var a = b.dataset.a, id = b.dataset.id;
    var byId = function () { return tiles.find(function (t) { return String(t.id) === String(id); }); };
    if (a === 'new') { cur = blank(); renderForm(); return; }
    if (a === 'edit') { var t = byId(); if (t) { cur = Object.assign(blank(), JSON.parse(JSON.stringify(t))); if (typeof cur.target === 'string') cur.target = JSON.parse(cur.target); renderForm(); window.scrollTo(0, 0); } return; }
    if (a === 'cancel') { renderList(); return; }
    if (a === 'save') { save(); return; }
    if (a === 'preview') { window.open('/index.html#tile=' + id, '_blank'); return; }
    if (a === 'toggle') {
      var x = byId(); if (!x) return;
      sb.from('tiles').update({ active: !(x.active !== false) }).eq('id', x.id).then(function (res) {
        if (res.error) { toast('Update failed: ' + explain(res.error.message), true); return; }
        x.active = !(x.active !== false); renderList();
      });
      return;
    }
    if (a === 'delete') {
      var d = byId(); if (!d) return;
      confirm('Delete Tile', 'Remove "' + (d.caption || 'this tile') + '" permanently?', async function () {
        showLoad('Deleting...');
        var res = await sb.from('tiles').delete().eq('id', d.id);
        hideLoad();
        if (res.error) { toast('Delete failed: ' + explain(res.error.message), true); return; }
        toast('Tile deleted'); await load(); renderList();
      });
    }
  }

  function bind() {
    var p = pane();
    if (p.dataset.bound) return;
    p.dataset.bound = '1';
    p.addEventListener('click', onClick);
    p.addEventListener('input', function (e) {
      var f = e.target.dataset && e.target.dataset.f;
      if (f && cur) cur[f] = e.target.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
    });
    p.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.re && cur) { cur[e.target.dataset.f] = e.target.value; var keep = dest && (function () { try { return dest.read(); } catch (_) { return cur.target; } })(); cur.target = keep || null; renderForm(); }
    });
  }

  window.TilesAdmin = {
    open: async function () {
      bind();
      if (!loaded) { pane().innerHTML = '<div class="ad-empty">Loading tiles...</div>'; try { await load(); await DestPicker.prepare(); } catch (e) { tableMissing = true; } renderList(); }
      else if (!cur) renderList();
    }
  };
})();
