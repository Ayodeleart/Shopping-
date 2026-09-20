/* Admin: Ads manager (list + builder), shown under Banners > Ads.
 *
 * An ad has two faces on the storefront:
 *   - a card in the home feed, placed after N rows of products
 *   - a brand page (components/ad-page.js) built from the hero, sections and contact details set here
 *
 * Uses globals from admin/index.html: sb, toast, confirm, showLoad, hideLoad, uploadImage.
 * Section editing lives in ads-sections.js. Table + columns: migration_ads_and_images.sql.
 */
(function () {
  'use strict';

  var ads = [], products = [], cur = null, loaded = false, tableMissing = false, uploading = 0;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var pane = function () { return document.getElementById('adsPane'); };

  function getp(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setp(o, path, v) {
    var ks = path.split('.'), last = ks.pop();
    var t = ks.reduce(function (a, k) { return a[k]; }, o);
    t[last] = v;
  }

  function blank() {
    return {
      id: null, name: '', brand: '', active: true, after_rows: 5, sort_order: 1, accent: '#3f4468',
      feed_image: '', feed_title: '', feed_sub: '', feed_cta: '', logo_url: '',
      page: { hero: [], contact: { email: '', phone: '' }, sections: [] }
    };
  }

  function fromRow(r) {
    var d = Object.assign(blank(), clone(r));
    var pg = typeof r.page === 'string' ? JSON.parse(r.page || '{}') : (r.page || {});
    d.page = { hero: pg.hero || [], contact: Object.assign({ email: '', phone: '' }, pg.contact || {}), sections: pg.sections || [] };
    ['brand', 'feed_image', 'feed_title', 'feed_sub', 'feed_cta', 'logo_url'].forEach(function (k) { if (d[k] == null) d[k] = ''; });
    return d;
  }

  function uploadMsg(err) {
    var m = (err && err.message) || String(err);
    if (/row-level security|policy/i.test(m)) return 'Upload blocked by the storage policy. Run migration_ads_and_images.sql in the Supabase SQL editor.';
    return m;
  }

  function explain(m) {
    if (/relation .*ads|schema cache|does not exist|Could not find the table/i.test(m)) return 'The ads table is missing. Run migration_ads_and_images.sql in the Supabase SQL editor.';
    if (/row-level security/i.test(m)) return 'Blocked by row-level security. Run migration_ads_and_images.sql and sign in with the admin Google account.';
    return m;
  }

  /* ── data ── */

  async function load() {
    var res = await Promise.all([
      sb.from('ads').select('*').order('sort_order', { ascending: true }),
      sb.from('products').select('id,name,brand,price,image_url,category').order('created_at', { ascending: false })
    ]);
    tableMissing = !!res[0].error;
    ads = res[0].data || [];
    products = res[1].data || [];
    loaded = true;
  }

  /* ── list ── */

  function itemHTML(a) {
    var live = a.active;
    return '<div class="aditem">' +
      '<div class="aditem-img">' + (a.feed_image ? '<img src="' + esc(a.feed_image) + '" alt="">' : '') + '</div>' +
      '<div class="aditem-body"><div class="aditem-name">' + esc(a.name) + '<span class="pill' + (live ? ' live' : '') + '">' + (live ? 'Live' : 'Paused') + '</span></div>' +
      '<div class="aditem-meta">' + esc(a.brand || 'No brand') + ' &middot; after ' + esc(a.after_rows) + ' row' + (a.after_rows == 1 ? '' : 's') + '</div></div>' +
      '<div class="aditem-acts">' +
        '<button class="abtn" data-a="edit" data-id="' + a.id + '">Edit</button>' +
        '<button class="abtn" data-a="preview" data-id="' + a.id + '">Preview</button>' +
        '<button class="abtn" data-a="toggle" data-id="' + a.id + '">' + (live ? 'Pause' : 'Resume') + '</button>' +
        '<button class="abtn danger" data-a="delete" data-id="' + a.id + '">Delete</button>' +
      '</div></div>';
  }

  function renderList() {
    cur = null;
    pane().innerHTML =
      '<div class="ph"><span class="pt">Ads</span><button class="abtn solid" data-a="new">+ New Ad</button></div>' +
      (tableMissing ? '<div class="ad-empty">The ads table is not set up yet. Run <b>migration_ads_and_images.sql</b> in the Supabase SQL editor, then reopen this tab.</div>' : '') +
      (ads.length ? ads.map(itemHTML).join('') : (tableMissing ? '' : '<div class="ad-empty">No ads yet. An ad shows a sponsored card in the home feed and opens a full brand page.</div>'));
  }

  /* ── form ── */

  function fieldInput(label, path, attrs) {
    return '<div class="fg"><label>' + label + '</label><input data-f="' + path + '" value="' + esc(getp(cur, path)) + '" ' + (attrs || '') + '></div>';
  }

  function renderForm() {
    var c = cur;
    pane().innerHTML =
      '<div class="fcard" id="adForm">' +
      '<h3>' + (c.id ? 'Edit Ad' : 'New Ad') + '</h3>' +

      '<div class="adgrp">Basics</div>' +
      fieldInput('Ad name *', 'name', 'type="text" placeholder="e.g. Oraimo Gadgets"') +
      '<div class="fg"><label>Brand keyword</label><input data-f="brand" value="' + esc(c.brand) + '" placeholder="e.g. Oraimo">' +
        '<div class="ad-match" id="adMatch"></div>' +
        '<div class="ad-hint">Products whose brand or name contains this word fill the brand page automatically.</div></div>' +
      '<div class="row2">' +
        '<div class="fg"><label>Show after (rows)</label><input type="number" min="1" data-f="after_rows" value="' + esc(c.after_rows) + '"></div>' +
        '<div class="fg"><label>Order</label><input type="number" min="1" data-f="sort_order" value="' + esc(c.sort_order) + '"></div>' +
      '</div>' +
      '<div class="ad-hint" style="margin:-4px 0 12px">The home feed shows 2 products per row, so 5 means the ad appears after 10 products. Ads on the same row are ordered by Order.</div>' +
      '<div class="fg"><label>Accent color (bands on the brand page)</label><input type="color" data-f="accent" value="' + esc(c.accent) + '" style="width:100%;height:38px;border:1.5px solid var(--border);border-radius:8px;background:var(--bg)"></div>' +
      '<div style="background:var(--bg2);border-radius:10px;padding:2px 10px;margin-bottom:6px"><div class="tgl-row"><label>Active (visible to shoppers)</label><div class="tgl' + (c.active ? ' on' : '') + '" data-tgl="active"><div class="tgl-k"></div></div></div></div>' +

      '<div class="adgrp">Card in the home feed</div>' +
      '<div class="fg"><label>Feed image (wide, about 2:1)</label><div data-pk="feed_image" data-max="1" data-label="Add image"></div></div>' +
      fieldInput('Title (optional)', 'feed_title', 'type="text" placeholder="Shown on the image"') +
      fieldInput('Subtitle (optional)', 'feed_sub', 'type="text" placeholder="e.g. Genuine gadgets, best prices"') +
      fieldInput('Button text', 'feed_cta', 'type="text" placeholder="Shop now"') +

      '<div class="adgrp">Brand page</div>' +
      '<div class="fg"><label>Brand logo</label><div data-pk="logo_url" data-max="1" data-label="Add logo"></div></div>' +
      '<div class="fg"><label>Hero banners (slide automatically)</label><div data-pk="page.hero" data-max="8" data-label="Add banners"></div><div class="ad-hint">Same shape for every banner (about 2:1) looks best. Add several to make it slide.</div></div>' +
      fieldInput('Support email (optional)', 'page.contact.email', 'type="email" placeholder="help@brand.com"') +
      fieldInput('Support phone (optional)', 'page.contact.phone', 'type="tel" placeholder="Uses the store phone when empty"') +

      '<div class="adgrp">Page sections</div>' +
      window.AdsSections.html(c, { products: products, cats: (typeof cats !== 'undefined' ? cats : []), catOptions: (window.DestPicker ? DestPicker.data.cats : []), esc: esc }) +

      '<div class="form-btns" style="margin-top:14px">' +
        '<button class="btn-p" data-a="save">Save Ad</button>' +
        '<button class="btn-s" data-a="cancel">Cancel</button>' +
      '</div>' +
      '<div class="uprog" id="adProg"><div class="uprog-bar" id="adProgBar" style="width:0%"></div></div>' +
      '</div>';
    mountPickers();
    updateMatch();
  }

  function mountPickers() {
    pane().querySelectorAll('[data-pk]').forEach(function (el) {
      var path = el.dataset.pk, max = parseInt(el.dataset.max, 10) || 1, hero = path === 'page.hero';
      var picker = new Pcx.MultiImagePicker(el, {
        max: max, label: el.dataset.label || 'Add photo',
        upload: async function (file) {
          uploading++;
          try { return await uploadImage(file, 'ads', 'adProgBar', 'adProg'); } finally { uploading--; }
        },
        onChange: function (urls) {
          if (hero) setp(cur, path, urls.map(function (u) { return { image: u }; }));
          else setp(cur, path, max === 1 ? (urls[0] || '') : urls);
        },
        onError: function (err) { toast(uploadMsg(err), true); }
      });
      var v = getp(cur, path);
      picker.setImages(hero ? (v || []).map(function (h) { return h.image; }) : (max === 1 ? (v ? [v] : []) : (v || [])));
    });
  }

  function updateMatch() {
    var el = document.getElementById('adMatch');
    if (!el) return;
    var b = (cur.brand || '').trim().toLowerCase();
    if (!b) { el.textContent = ''; return; }
    var n = products.filter(function (p) {
      return (p.brand || '').toLowerCase() === b || (p.name || '').toLowerCase().indexOf(b) !== -1;
    }).length;
    el.textContent = n + ' product' + (n === 1 ? '' : 's') + ' match' + (n === 1 ? 'es' : '') + ' this brand';
    el.className = 'ad-match' + (n ? '' : ' none');
  }

  /* ── save ── */

  function cleanPage(pg) {
    var sections = (pg.sections || []).filter(function (s) {
      if (s.type === 'products') return true;
      if (s.type === 'cards') return (s.items || []).some(function (i) { return i.title || i.image; });
      if (s.type === 'banner') return !!s.image;
      if (s.type === 'video') return !!(s.url || '').trim();
      if (s.type === 'text') return !!(s.title || s.body);
      return false;
    }).map(function (s) {
      var out = clone(s);
      if (out.type === 'products') {
        out.limit = parseInt(out.limit, 10) || 12; out.ids = (out.ids || []).map(Number);
        ['discountMin', 'priceMax'].forEach(function (k) { out[k] = parseFloat(out[k]) || undefined; });
        out.categoryId = parseInt(out.categoryId, 10) || undefined;
        ['category', 'keyword', 'flag', 'sort'].forEach(function (k) { if (!out[k]) delete out[k]; });
      }
      if (out.type === 'cards') out.items = (out.items || []).map(function (i) { i.product_id = Number(i.product_id) || null; return i; });
      if (out.type === 'banner') out.product_id = Number(out.product_id) || null;
      return out;
    });
    return { hero: (pg.hero || []).filter(function (h) { return h.image; }), contact: pg.contact || {}, sections: sections };
  }

  async function save() {
    if (!cur.name.trim()) { toast('Ad name required', true); return; }
    if (uploading) { toast('Wait for the image uploads to finish', true); return; }
    var row = {
      name: cur.name.trim(), brand: (cur.brand || '').trim() || null, active: !!cur.active,
      after_rows: Math.max(1, parseInt(cur.after_rows, 10) || 5), sort_order: parseInt(cur.sort_order, 10) || 1,
      accent: cur.accent || '#3f4468', feed_image: cur.feed_image || null, feed_title: (cur.feed_title || '').trim() || null,
      feed_sub: (cur.feed_sub || '').trim() || null, feed_cta: (cur.feed_cta || '').trim() || null,
      logo_url: cur.logo_url || null, page: cleanPage(cur.page)
    };
    showLoad('Saving ad...');
    var q = cur.id ? sb.from('ads').update(row).eq('id', cur.id) : sb.from('ads').insert([row]);
    var res = await q;
    hideLoad();
    if (res.error) { toast('Save failed: ' + explain(res.error.message), true); console.error(res.error); return; }
    toast(cur.id ? 'Ad updated' : 'Ad created');
    await load();
    renderList();
  }

  /* ── events ── */

  function readValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return el.value === '' ? '' : Number(el.value);
    return el.value;
  }

  function onAction(e) {
    var b = e.target.closest('[data-a]');
    if (!b || !pane().contains(b)) return;
    var a = b.dataset.a, id = b.dataset.id;
    var byId = function () { return ads.find(function (x) { return String(x.id) === String(id); }); };
    if (a === 'new') { cur = blank(); renderForm(); pane().scrollIntoView({ behavior: 'smooth' }); return; }
    if (a === 'edit') { var r = byId(); if (r) { cur = fromRow(r); renderForm(); window.scrollTo(0, 0); } return; }
    if (a === 'cancel') { renderList(); return; }
    if (a === 'save') { save(); return; }
    if (a === 'preview') { window.open('/index.html#ad=' + id, '_blank'); return; }
    if (a === 'toggle') {
      var t = byId(); if (!t) return;
      sb.from('ads').update({ active: !t.active }).eq('id', t.id).then(function (res) {
        if (res.error) { toast('Update failed: ' + explain(res.error.message), true); return; }
        t.active = !t.active; renderList();
      });
      return;
    }
    if (a === 'delete') {
      var d = byId(); if (!d) return;
      confirm('Delete Ad', 'Remove "' + d.name + '" permanently?', async function () {
        showLoad('Deleting...');
        var res = await sb.from('ads').delete().eq('id', d.id);
        hideLoad();
        if (res.error) { toast('Delete failed: ' + explain(res.error.message), true); return; }
        toast('Ad deleted'); await load(); renderList();
      });
      return;
    }
    /* everything else belongs to the section builder */
    if (cur && window.AdsSections.act(a, b, cur, { products: products, openPicker: true })) renderForm();
  }

  function onInput(e) {
    var el = e.target, f = el.dataset && el.dataset.f;
    if (!f || !cur) return;
    setp(cur, f, readValue(el));
    if (f === 'brand') updateMatch();
    if (el.dataset.sum) { var s = el.closest('.sec-card'); var t = s && s.querySelector('.sec-sum'); if (t) t.textContent = el.value || 'Untitled'; }
  }

  function onChange(e) {
    var el = e.target;
    if (el.dataset && el.dataset.re && cur) { setp(cur, el.dataset.f, readValue(el)); renderForm(); }
  }

  function onToggle(e) {
    var t = e.target.closest('[data-tgl]');
    if (!t || !cur) return;
    t.classList.toggle('on');
    cur[t.dataset.tgl] = t.classList.contains('on');
  }

  function bind() {
    var p = pane();
    if (p.dataset.bound) return;
    p.dataset.bound = '1';
    p.addEventListener('click', function (e) { onToggle(e); onAction(e); });
    p.addEventListener('input', onInput);
    p.addEventListener('change', onChange);
  }

  /* ── public ── */

  window.__adsDraft = function () { return cur; };

  window.AdsAdmin = {
    getp: getp, setp: setp, esc: esc,
    rerender: function () { if (cur) renderForm(); },
    products: function () { return products; },
    open: async function () {
      bind();
      if (!loaded) { pane().innerHTML = '<div class="ad-empty">Loading ads...</div>'; try { await load(); await DestPicker.prepare(); } catch (e) { tableMissing = true; } renderList(); }
      else if (!cur) renderList();
    },
    reload: async function () { loaded = false; if (pane().offsetParent) await this.open(); }
  };

  /* Banners | Ads | Announcements switch */
  window.switchBannerSub = function (which) {
    document.querySelectorAll('.bsub-tab').forEach(function (t) { t.classList.toggle('on', t.dataset.sub === which); });
    document.getElementById('bannersPane').style.display = which === 'banners' ? '' : 'none';
    document.getElementById('tilesPane').style.display = which === 'tiles' ? '' : 'none';
    document.getElementById('adsPane').style.display = which === 'ads' ? '' : 'none';
    document.getElementById('announcePane').style.display = which === 'announce' ? '' : 'none';
    if (which === 'ads') window.AdsAdmin.open();
    if (which === 'tiles') window.TilesAdmin.open();
  };
})();
