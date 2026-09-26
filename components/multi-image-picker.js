/* Pcx.MultiImagePicker
 * Multi-photo picker used by the admin and vendor product forms and the admin ad builder.
 * The first photo is the "main" photo: tap any other photo to make it the main one.
 *
 *   const picker = new Pcx.MultiImagePicker(el, {
 *     max: 8,                 // 1 = single image field
 *     label: 'Add photos',
 *     upload: async file => url,   // optional: upload as soon as files are chosen (ad builder)
 *     onChange(urls) {},           // urls that are already uploaded, in order
 *     onError(err) {}
 *   });
 *   picker.setImages(urls);        // load existing photos
 *   picker.hasPending();           // chosen files that are not uploaded yet
 *   await picker.resolve(uploadFn) // upload pending files (deferred mode) and return every url, in order
 *   picker.clear();
 *
 * Without `upload`, chosen files are kept locally until resolve() is called from the form's Save handler,
 * so cancelling a form never leaves stray uploads behind.
 */
(function (global) {
  'use strict';

  var ADD_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

  function MultiImagePicker(root, opts) {
    this.root = root;
    this.o = Object.assign({ max: 8, label: 'Add photos', upload: null, onChange: null, onError: null }, opts);
    this.items = [];
    this._render();
  }

  var P = MultiImagePicker.prototype;

  P.setImages = function (urls) {
    this._revoke();
    this.items = (urls || []).filter(Boolean).slice(0, this.o.max).map(function (u) { return { url: u, state: 'ready' }; });
    this._render();
  };

  P.clear = function () { this.setImages([]); };

  P.getImages = function () {
    return this.items.filter(function (i) { return i.url; }).map(function (i) { return i.url; });
  };

  /* Every photo the vendor/admin can currently SEE in this picker, uploaded or not: an already-uploaded photo by
     its real url, a just-chosen (not yet uploaded) photo by its local preview url. Lets colour-photo linking
     (see product-attributes.js colorGroup) work in the SAME session a product is being created, before Save —
     not only after reopening a saved product. Order matches the picker. */
  P.getLinkable = function () {
    return this.items.map(function (i) { return i.url || i.preview; }).filter(Boolean);
  };

  /* After resolve() uploads pending photos, any colour-photo link recorded against a photo's temporary preview
     url needs to move to its real, permanent url. This returns {previewUrl: realUrl} for every photo uploaded
     this call, so the caller can pass it to ProductAttributes#remapColorImages() right after resolve(). Photos
     that were already uploaded (loaded via setImages) never had a preview url, so they're never remapped. */
  P.getUploadRemap = function () {
    var m = {};
    this.items.forEach(function (i) { if (i.preview && i.url) m[i.preview] = i.url; });
    return m;
  };

  /* every photo as { file } (chosen, not uploaded yet) or { url } (already stored): used by the AI listing assistant */
  P.getSources = function () {
    return this.items.map(function (i) { return i.file && !i.url ? { file: i.file } : { url: i.url }; }).filter(function (i) { return i.file || i.url; });
  };

  P.hasPending = function () {
    return this.items.some(function (i) { return i.file && !i.url; });
  };

  P.resolve = async function (uploadFn) {
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      if (it.file && !it.url) {
        it.state = 'uploading'; this._render();
        it.url = await uploadFn(it.file);
        it.state = 'ready'; delete it.file;
      }
    }
    this._render();
    return this.getImages();
  };

  P._revoke = function () {
    this.items.forEach(function (i) { if (i.preview) URL.revokeObjectURL(i.preview); });
  };

  P._changed = function () {
    if (this.o.onChange) this.o.onChange(this.getImages());
  };

  P._add = async function (fileList) {
    var self = this;
    var room = this.o.max - this.items.length;
    var files = Array.prototype.slice.call(fileList).filter(function (f) { return /^image\//.test(f.type) || !f.type; }).slice(0, Math.max(0, room));
    if (!files.length) return;
    var added = files.map(function (f) {
      return { file: f, preview: URL.createObjectURL(f), state: self.o.upload ? 'uploading' : 'pending' };
    });
    this.items = this.items.concat(added);
    this._render();
    if (!this.o.upload) return;
    for (var k = 0; k < added.length; k++) {
      var it = added[k];
      try {
        it.url = await this.o.upload(it.file);
        it.state = 'ready'; delete it.file;
      } catch (err) {
        this.items = this.items.filter(function (x) { return x !== it; });
        if (it.preview) URL.revokeObjectURL(it.preview);
        if (this.o.onError) this.o.onError(err);
      }
      this._render();
      this._changed();
    }
  };

  P._render = function () {
    var self = this, o = this.o;
    this.root.textContent = '';
    var wrap = document.createElement('div');
    wrap.className = 'mip' + (o.max === 1 ? ' mip--single' : '');
    var grid = document.createElement('div');
    grid.className = 'mip__grid';

    this.items.forEach(function (it, idx) {
      var cell = document.createElement('div');
      cell.className = 'mip__item' + (idx === 0 && o.max > 1 ? ' is-main' : '') + (it.state !== 'ready' ? ' is-busy' : '');
      var img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = safeHref(it.url || it.preview);
      cell.appendChild(img);
      if (idx === 0 && o.max > 1) {
        var tag = document.createElement('span'); tag.className = 'mip__tag'; tag.textContent = 'Main'; cell.appendChild(tag);
      }
      if (it.state === 'uploading') {
        var sp = document.createElement('span'); sp.className = 'mip__spin'; cell.appendChild(sp);
      }
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'mip__x'; x.setAttribute('aria-label', 'Remove photo');
      x.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      x.addEventListener('click', function (e) {
        e.stopPropagation();
        if (it.preview) URL.revokeObjectURL(it.preview);
        self.items = self.items.filter(function (v) { return v !== it; });
        self._render(); self._changed();
      });
      cell.appendChild(x);
      if (o.max > 1) {
        cell.addEventListener('click', function () {
          if (idx === 0 || it.state === 'uploading') return;
          self.items.splice(idx, 1); self.items.unshift(it);
          self._render(); self._changed();
        });
      }
      grid.appendChild(cell);
    });

    if (this.items.length < o.max) {
      var add = document.createElement('div');
      add.className = 'mip__add';
      add.innerHTML = ADD_ICON + '<span></span>';
      add.lastChild.textContent = this.items.length ? 'Add more' : o.label;
      var input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.multiple = o.max > 1;
      input.addEventListener('change', function () { self._add(input.files); input.value = ''; });
      add.appendChild(input);
      grid.appendChild(add);
    }
    wrap.appendChild(grid);
    if (o.max > 1 && this.items.length > 1) {
      var hint = document.createElement('div');
      hint.className = 'mip__hint'; hint.textContent = 'Tap a photo to make it the main one.';
      wrap.appendChild(hint);
    }
    this.root.appendChild(wrap);
  };

  (global.Pcx = global.Pcx || {}).MultiImagePicker = MultiImagePicker;
})(window);
