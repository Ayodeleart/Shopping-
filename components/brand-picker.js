/* Pcx.BrandPicker
 * Type-ahead brand field for the vendor and admin product forms.
 *
 *   const brand = new Pcx.BrandPicker(document.getElementById('pBrandBox'), {
 *     sb,                                   // supabase client (reads/writes the `brands` table)
 *     searchUrl: '/api/brand-search',       // serverless logo.dev search (keeps the secret key off the client)
 *     getToken: async () => accessToken,    // the signed-in user's Supabase access token
 *     getUserId: () => userId,              // optional, stored as brands.created_by
 *     upload: async file => publicUrl       // optional, lets a vendor upload a logo for a brand nobody has listed yet
 *   });
 *   brand.getValue();                       // { id, name, domain, logo_url, source } or null
 *   await brand.setByProduct(id, name);     // show the brand a product already has
 *   const row = await brand.commit();       // make sure the brand exists in `brands`; returns the row (or null)
 *   brand.clear();
 *
 * How a search works: brands already saved in your own table come first (instant, free), then logo.dev results
 * for anything new, and the last row always lets the vendor add the brand by hand, so nobody is ever stuck
 * waiting for a hardcoded list to catch up.
 *
 * Needs the `brands` table (its SQL is run from the chat). Text is inserted with textContent only.
 */
(function (global) {
  'use strict';

  var X_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var PLUS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function cleanName(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
  function slugOf(name) { return cleanName(name).toLowerCase(); }

  /* logo tile: image with a letter fallback when it is missing or fails to load */
  function logoTile(name, url) {
    var box = h('span', 'bp__logo');
    var letter = (cleanName(name)[0] || '?').toUpperCase();
    function fallback() { box.textContent = letter; box.classList.add('is-letter'); }
    if (url) {
      var img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('error', function () { img.remove(); fallback(); }, { once: true });
      img.src = url;
      box.appendChild(img);
    } else fallback();
    return box;
  }

  function BrandPicker(root, opts) {
    this.root = root;
    this.o = Object.assign({
      sb: null, searchUrl: '/api/brand-search', getToken: null, getUserId: null, upload: null,
      placeholder: 'Search a brand, e.g. Samsung', onChange: null
    }, opts);
    this.value = null;
    this.timer = null;
    this.seq = 0;
    var self = this;
    this._outside = function (e) { if (!self.root.contains(e.target)) self._closeList(); };
    document.addEventListener('pointerdown', this._outside);
    this._render();
  }

  var P = BrandPicker.prototype;

  P.destroy = function () {
    document.removeEventListener('pointerdown', this._outside);
    clearTimeout(this.timer);
    this.root.textContent = '';
  };

  P.getValue = function () {
    return this.value ? Object.assign({}, this.value) : null;
  };

  P.setValue = function (v) {
    if (this.value && this.value.preview) URL.revokeObjectURL(this.value.preview);
    this.value = v && cleanName(v.name) ? {
      id: v.id || null, name: cleanName(v.name), domain: v.domain || null,
      logo_url: v.logo_url || null, source: v.source || 'custom'
    } : null;
    this._render();
    if (this.o.onChange) this.o.onChange(this.getValue());
  };

  P.clear = function () { this.setValue(null); };

  /* show the brand a product already has, then fill in its logo from the brands table */
  P.setByProduct = async function (id, name) {
    name = cleanName(name);
    if (!id && !name) { this.clear(); return; }
    this.setValue({ id: id || null, name: name || '…' });
    var sb = this.o.sb;
    if (!sb) return;
    try {
      var q = sb.from('brands').select('*');
      q = id ? q.eq('id', id) : q.eq('slug', slugOf(name));
      var res = await q.maybeSingle();
      if (res.data) this.setValue(res.data);
      else if (id) this.setValue({ id: null, name: name });
    } catch (_) { /* keep the plain-name chip */ }
  };

  /* make sure the chosen brand exists in the brands table, uploading a custom logo first if there is one */
  P.commit = async function () {
    var v = this.value, sb = this.o.sb;
    if (!v || !cleanName(v.name)) return null;
    if (v.id) return this.getValue();
    if (!sb) return this.getValue();

    var slug = slugOf(v.name);
    var found = await sb.from('brands').select('*').eq('slug', slug).maybeSingle();
    if (found.data) { this._adopt(found.data); return this.getValue(); }

    var logo = v.logo_url || null;
    if (v.file && this.o.upload) {
      try { logo = await this.o.upload(v.file); } catch (e) { logo = null; }
    }
    var userId = this.o.getUserId ? this.o.getUserId() : null;
    var row = { name: cleanName(v.name), slug: slug, domain: v.domain || null, logo_url: logo, source: v.source === 'logo.dev' ? 'logo.dev' : 'custom' };
    if (userId) row.created_by = userId;

    var ins = await sb.from('brands').insert([row]).select().single();
    if (ins.error) {
      // someone saved the same brand a moment ago: use theirs
      var again = await sb.from('brands').select('*').eq('slug', slug).maybeSingle();
      if (again.data) { this._adopt(again.data); return this.getValue(); }
      throw ins.error;
    }
    this._adopt(ins.data);
    return this.getValue();
  };

  P._adopt = function (row) {
    if (this.value && this.value.preview) URL.revokeObjectURL(this.value.preview);
    this.value = { id: row.id, name: row.name, domain: row.domain || null, logo_url: row.logo_url || null, source: row.source || 'custom' };
    this._render();
  };

  /* ── rendering ───────────────────────────────────── */

  P._render = function () {
    var self = this;
    this.root.textContent = '';
    var wrap = h('div', 'bp');
    this.wrap = wrap;

    if (this.value) {
      var v = this.value;
      var chip = h('div', 'bp__chip');
      chip.appendChild(logoTile(v.name, v.preview || v.logo_url));
      var info = h('span', 'bp__info');
      info.appendChild(h('span', 'bp__name', v.name));
      var sub = v.domain || (v.id ? 'Saved brand' : 'New brand');
      info.appendChild(h('span', 'bp__sub', sub));
      chip.appendChild(info);
      var x = h('button', 'bp__x'); x.type = 'button'; x.setAttribute('aria-label', 'Remove brand');
      x.innerHTML = X_ICON;
      x.addEventListener('click', function () { self.clear(); });
      chip.appendChild(x);
      wrap.appendChild(chip);

      // a brand nobody has listed yet can carry its own logo
      if (!v.id && !v.logo_url && this.o.upload) {
        var lbl = h('label', 'bp__upload');
        lbl.appendChild(h('span', null, v.preview ? 'Change logo' : 'Upload a logo (optional)'));
        var file = document.createElement('input');
        file.type = 'file'; file.accept = 'image/*';
        file.addEventListener('change', function () {
          var f = file.files && file.files[0];
          if (!f) return;
          if (self.value.preview) URL.revokeObjectURL(self.value.preview);
          self.value.file = f;
          self.value.preview = URL.createObjectURL(f);
          self._render();
        });
        lbl.appendChild(file);
        wrap.appendChild(lbl);
      }
    } else {
      var input = h('input', 'bp__input');
      input.type = 'text';
      input.placeholder = this.o.placeholder;
      input.autocomplete = 'off';
      input.setAttribute('autocapitalize', 'words');
      input.setAttribute('spellcheck', 'false');
      input.addEventListener('input', function () { self._onInput(); });
      input.addEventListener('focus', function () { if (input.value.trim()) self._onInput(); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); var first = self.list && self.list.querySelector('.bp__row[data-pick]'); if (first) first.click(); }
        else if (e.key === 'Escape') self._closeList();
      });
      this.input = input;
      wrap.appendChild(input);
      this.list = h('div', 'bp__list');
      this.list.hidden = true;
      wrap.appendChild(this.list);
    }
    this.root.appendChild(wrap);
  };

  P._onInput = function () {
    var self = this, q = this.input.value.trim();
    clearTimeout(this.timer);
    if (!q) { this._closeList(); return; }
    this._showRows([{ kind: 'msg', text: 'Searching…' }], q);
    this.timer = setTimeout(function () { self._search(q); }, 250);
  };

  P._closeList = function () { if (this.list) this.list.hidden = true; };

  P._search = async function (q) {
    var seq = ++this.seq, self = this;
    var local = [];
    try { local = await this._local(q); } catch (_) { local = []; }
    if (seq !== this.seq) return;

    var canOnline = q.length >= 2 && this.o.searchUrl && this.o.getToken;
    var base = local.map(function (b) { return { kind: 'local', brand: b }; });
    this._showRows(base.concat(canOnline ? [{ kind: 'msg', text: 'Searching online…' }] : []), q);
    if (!canOnline) return;

    var remote = { list: [], err: null };
    try { remote = await this._remote(q); } catch (e) { remote = { list: [], err: e.message || 'offline' }; }
    if (seq !== this.seq) return;

    var haveDomain = {}, haveName = {};
    local.forEach(function (b) { if (b.domain) haveDomain[b.domain.toLowerCase()] = 1; haveName[slugOf(b.name)] = 1; });
    var online = remote.list.filter(function (r) { return !haveDomain[r.domain] && !haveName[slugOf(r.name)]; });
    var rows = base.concat(online.map(function (r) { return { kind: 'remote', brand: r }; }));
    if (remote.err && !local.length) rows.push({ kind: 'msg', text: 'Online search is unavailable right now. You can still add the brand below.' });
    this._showRows(rows, q);
  };

  P._local = async function (q) {
    var sb = this.o.sb;
    if (!sb) return [];
    var like = '%' + q.replace(/[\\%_]/g, function (m) { return '\\' + m; }) + '%';
    var res = await sb.from('brands').select('*').ilike('name', like).order('name').limit(6);
    return res.data || [];
  };

  P._remote = async function (q) {
    var token = await this.o.getToken();
    if (!token) return { list: [], err: 'not signed in' };
    var r = await fetch(this.o.searchUrl + '?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      var msg = '';
      try { msg = (await r.json()).error; } catch (_) {}
      return { list: [], err: msg || ('HTTP ' + r.status) };
    }
    var j = await r.json();
    return { list: Array.isArray(j.results) ? j.results : [], err: null };
  };

  P._showRows = function (rows, q) {
    var self = this;
    if (!this.list) return;
    this.list.textContent = '';
    rows.forEach(function (row) {
      if (row.kind === 'msg') { this.list.appendChild(h('div', 'bp__msg', row.text)); return; }
      var b = row.brand;
      var btn = h('button', 'bp__row'); btn.type = 'button'; btn.dataset.pick = '1';
      btn.appendChild(logoTile(b.name, b.logo_url));
      var info = h('span', 'bp__info');
      info.appendChild(h('span', 'bp__name', b.name));
      info.appendChild(h('span', 'bp__sub', row.kind === 'local' ? (b.domain || 'Saved brand') : b.domain));
      btn.appendChild(info);
      if (row.kind === 'local') btn.appendChild(h('span', 'bp__tag', 'Saved'));
      btn.addEventListener('click', function () {
        self.setValue(row.kind === 'local' ? b : { id: null, name: b.name, domain: b.domain, logo_url: b.logo_url, source: 'logo.dev' });
      });
      this.list.appendChild(btn);
    }, this);

    var typed = cleanName(q);
    var exact = rows.some(function (r) { return r.brand && slugOf(r.brand.name) === slugOf(typed); });
    if (typed && !exact) {
      var add = h('button', 'bp__row bp__row--add'); add.type = 'button';
      if (!rows.some(function (r) { return r.brand; })) add.dataset.pick = '1';   // Enter adds it when nothing else matched
      var ic = h('span', 'bp__logo is-add'); ic.innerHTML = PLUS_ICON;
      add.appendChild(ic);
      var ai = h('span', 'bp__info');
      ai.appendChild(h('span', 'bp__name', 'Add "' + typed + '" as a new brand'));
      ai.appendChild(h('span', 'bp__sub', 'Not listed? Add it yourself'));
      add.appendChild(ai);
      add.addEventListener('click', function () { self.setValue({ id: null, name: typed, source: 'custom' }); });
      this.list.appendChild(add);
    }
    this.list.hidden = false;
  };

  (global.Pcx = global.Pcx || {}).BrandPicker = BrandPicker;
})(window);
