/* Pcx.AIProduct: "Generate with AI" panel for the product form (vendor + admin).
 *
 * The AI only produces a DRAFT. Nothing is saved from here: "Apply to form" fills the normal form fields, the seller keeps
 * editing them there, and the existing Save button is still the only thing that publishes.
 *
 *   const ai = new Pcx.AIProduct(rootEl, {
 *     endpoint: '/api/ai-product', getToken: async () => accessToken,
 *     getPicker: () => pPicker,                   // Pcx.MultiImagePicker
 *     getInput: () => ({ name, brand, price, category, vendorAttributes }),
 *     apply: { title(v), shortDescription(v), description(v), highlights(list), categoryId(id), attributes(obj) }   // any subset
 *   });
 *   ai.extras()        // { tags, image_alt, ai_assisted } to merge into products.attributes on save (or null)
 *   ai.setExisting(attrs) / ai.reset()
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};
  var SPARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 2l2.2 6.3L19.5 10.5 13.2 12.7 11 19l-2.2-6.3L2.5 10.5l6.3-2.2L11 2z"/><path d="M19 14l1 2.9 2.9 1-2.9 1-1 2.9-1-2.9-2.9-1 2.9-1 1-2.9z"/></svg>';
  var NOTICE = 'AI-generated draft \u2014 please review before publishing.';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    [].concat(kids == null ? [] : kids).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  /* shrink a chosen photo to a small JPEG so the request stays far below the host's body limit */
  function toDataUrl(file, max) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * r)), h = Math.max(1, Math.round(img.naturalHeight * r));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
      img.src = url;
    });
  }

  function AIProduct(root, opts) {
    this.root = root; this.o = opts; this.draft = null; this.cat = null; this.busy = false; this.applied = false; this.existing = null; this.err = '';
    this._render();
  }
  var P = AIProduct.prototype;

  P.reset = function () { this.draft = null; this.applied = false; this.existing = null; this.err = ''; if (this.extra) this.extra.value = ''; this._render(); };
  P.setExisting = function (attrs) {
    this.existing = attrs && (Array.isArray(attrs.tags) || attrs.image_alt || attrs.ai_assisted) ? { tags: attrs.tags, image_alt: attrs.image_alt, ai_assisted: !!attrs.ai_assisted } : null;
  };
  /* extra keys stored inside products.attributes (no new database column needed) */
  P.extras = function () {
    if (this.applied && this.draft) {
      var out = { ai_assisted: true };
      if (this.draft.tags.length) out.tags = this.draft.tags.slice(0, 15);
      if (this.draft.altText) out.image_alt = this.draft.altText;
      return out;
    }
    if (!this.existing) return null;
    var e = {}; if (Array.isArray(this.existing.tags)) e.tags = this.existing.tags; if (this.existing.image_alt) e.image_alt = this.existing.image_alt; if (this.existing.ai_assisted) e.ai_assisted = true;
    return e;
  };

  P._images = async function () {
    var picker = this.o.getPicker(), out = [], src = picker ? picker.getSources() : [];
    for (var i = 0; i < src.length && out.length < 3; i++) {
      if (src[i].file) { try { out.push({ dataUrl: await toDataUrl(src[i].file, 1024) }); } catch (e) { /* skip unreadable photo */ } }
      else if (/^https:\/\//.test(src[i].url)) out.push({ url: src[i].url });
    }
    return out;
  };

  P._generate = async function (fields) {
    var self = this;
    if (this.busy) return;
    var input = this.o.getInput();
    var images = await this._images();
    if (!String(input.name || '').trim() && !images.length) { this.err = 'Enter a product name or add a photo first.'; this._render(); return; }
    var prev = this.draft ? this._collect() : null;   // keep the seller's edits: the busy re-render must not throw them away
    if (prev) this.draft = prev;
    this.busy = true; this.err = ''; this._render();
    try {
      var token = await this.o.getToken();
      if (!token) throw new Error('Please sign in again.');
      var body = Object.assign({}, input, { images: images, specifications: this.extra ? this.extra.value.trim() : '' });
      if (fields && prev) { body.fields = fields; body.previous = prev; }
      var res = await fetch(this.o.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      var j = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(j.error || 'The AI could not generate a draft. Please try again.');
      this.draft = j.draft; this.cat = j.categoryId == null ? null : j.categoryId; this.applied = false;
    } catch (e) { this.err = e && e.message ? e.message : 'Something went wrong. Please try again.'; }
    this.busy = false; this._render();
  };

  /* what the seller currently sees in the draft editor (edits included) */
  P._collect = function () {
    var d = this.draft, f = this.f || {};
    return {
      title: f.title ? f.title.value.trim() : d.title, shortDescription: f.short ? f.short.value.trim() : d.shortDescription, description: f.desc ? f.desc.value.trim() : d.description,
      highlights: this.hl ? this.hl.slice() : d.highlights, category: d.category, tags: f.tags ? f.tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : d.tags,
      attributes: this.attrs ? Object.assign({}, this.attrs) : d.attributes, detectedText: d.detectedText, altText: f.alt ? f.alt.value.trim() : d.altText,
      missingInformation: d.missingInformation, warnings: d.warnings, confidence: d.confidence
    };
  };

  P._apply = function () {
    var d = this._collect(), a = this.o.apply || {}, n = 0;
    this.draft = d;
    if (a.title && d.title) { a.title(d.title); n++; }
    if (a.shortDescription && d.shortDescription) { a.shortDescription(d.shortDescription); n++; }
    if (a.description && d.description) { a.description(d.description); n++; }
    if (a.highlights && d.highlights.length) { a.highlights(d.highlights); n++; }
    if (a.categoryId && this.cat != null) { a.categoryId(this.cat); n++; }
    if (a.attributes && Object.keys(d.attributes).length) { a.attributes(d.attributes); n++; }
    this.applied = true; this._render();
    if (this.o.onApplied) this.o.onApplied(n);
  };

  P._render = function () {
    var self = this, root = this.root, d = this.draft;
    var keepExtra = this.extra ? this.extra.value : '';
    root.textContent = '';
    var box = el('section', { class: 'aip', 'aria-label': 'AI listing assistant' });
    box.appendChild(el('div', { class: 'aip-hd' }, [el('span', { html: SPARK }), el('b', {}, ['AI listing assistant'])]));
    box.appendChild(el('p', { class: 'aip-sub' }, ['Add a name and/or photos, then let AI write a draft. It only uses what you enter or what is clearly visible, and lists what is missing. You review and edit everything before saving.']));
    this.extra = el('textarea', { rows: '2', maxlength: '2000', placeholder: 'Optional facts to use: size, colour, condition, material, specifications\u2026', 'aria-label': 'Extra product details for the AI' });
    this.extra.value = keepExtra; box.appendChild(this.extra);
    var go = el('button', { class: 'aip-btn pri', type: 'button', disabled: this.busy ? '' : null, onclick: function () { self._generate(); } }, [this.busy ? 'Generating\u2026' : (d ? 'Regenerate all' : 'Generate with AI')]);
    var row = el('div', { class: 'aip-row' }, [go]);
    if (d && !this.busy) row.appendChild(el('button', { class: 'aip-btn', type: 'button', onclick: function () { self.draft = null; self.applied = false; self.err = ''; self._render(); } }, ['Reject draft']));
    box.appendChild(row);
    if (this.err) box.appendChild(el('div', { class: 'aip-err', role: 'alert' }, [this.err]));
    if (d) this._draftUi(box);
    else if (this.applied === false && this.existing && this.existing.ai_assisted) box.appendChild(el('div', { class: 'aip-applied' }, ['This product was created with AI help.']));
    root.appendChild(box);
  };

  P._draftUi = function (box) {
    var self = this, d = this.draft;
    this.f = {}; this.hl = d.highlights.slice(); this.attrs = Object.assign({}, d.attributes);
    box.appendChild(el('div', { class: 'aip-banner', role: 'note' }, [NOTICE]));
    box.appendChild(el('div', {}, ['Confidence: ', el('span', { class: 'aip-chip ' + d.confidence }, [d.confidence])]));
    var regen = function (key) { return el('button', { type: 'button', onclick: function () { self.draft = self._collect(); self._generate([key]); } }, ['Regenerate']); };
    var field = function (label, key, node) { box.appendChild(el('div', { class: 'aip-fld' }, [el('label', {}, [label, regen(key)]), node])); };
    this.f.title = el('input', { type: 'text', maxlength: '140', 'aria-label': 'Title' }); this.f.title.value = d.title; field('Title', 'title', this.f.title);
    this.f.short = el('textarea', { rows: '2', maxlength: '300', 'aria-label': 'Short description' }); this.f.short.value = d.shortDescription; field('Short description', 'shortDescription', this.f.short);
    this.f.desc = el('textarea', { rows: '6', maxlength: '3000', 'aria-label': 'Full description' }); this.f.desc.value = d.description; field('Full description', 'description', this.f.desc);

    var hlBox = el('div', {});
    var paintHl = function () {
      hlBox.textContent = '';
      self.hl.forEach(function (t, i) {
        var inp = el('input', { type: 'text', maxlength: '200', 'aria-label': 'Highlight ' + (i + 1) }); inp.value = t; inp.addEventListener('input', function () { self.hl[i] = inp.value; });
        hlBox.appendChild(el('div', { class: 'aip-li' }, [inp, el('button', { type: 'button', 'aria-label': 'Remove highlight', onclick: function () { self.hl.splice(i, 1); paintHl(); } }, ['\u00d7'])]));
      });
      hlBox.appendChild(el('button', { class: 'aip-btn', type: 'button', onclick: function () { if (self.hl.length < 8) { self.hl.push(''); paintHl(); } } }, ['+ Add highlight']));
    };
    paintHl(); field('Highlights', 'highlights', hlBox);

    var atBox = el('div', {});
    var paintAt = function () {
      atBox.textContent = '';
      Object.keys(self.attrs).forEach(function (k) {
        var v = self.attrs[k], inp = el('input', { type: 'text', maxlength: '300', 'aria-label': k }); inp.value = Array.isArray(v) ? v.join(', ') : v;
        inp.addEventListener('input', function () { self.attrs[k] = inp.value; });
        atBox.appendChild(el('div', { class: 'aip-li' }, [el('span', { style: 'min-width:80px;font-size:12px;color:var(--txt2);align-self:center' }, [k]), inp,
          el('button', { type: 'button', 'aria-label': 'Remove ' + k, onclick: function () { delete self.attrs[k]; paintAt(); } }, ['\u00d7'])]));
      });
      if (!Object.keys(self.attrs).length) atBox.appendChild(el('div', { class: 'aip-applied' }, ['No attributes suggested.']));
    };
    paintAt(); field('Attributes seen or supplied', 'attributes', atBox);

    this.f.tags = el('input', { type: 'text', maxlength: '400', 'aria-label': 'Search tags' }); this.f.tags.value = d.tags.join(', '); field('Search tags (comma separated)', 'tags', this.f.tags);
    this.f.alt = el('input', { type: 'text', maxlength: '200', 'aria-label': 'Image alt text' }); this.f.alt.value = d.altText; field('Image alt text', 'altText', this.f.alt);
    if (d.category) box.appendChild(el('div', { class: 'aip-applied' }, ['Suggested category: ' + d.category + (this.cat == null ? ' (choose it yourself in the form)' : '')]));

    var list = function (cls, title, items) { if (items && items.length) box.appendChild(el('div', { class: 'aip-box ' + cls }, [el('h5', {}, [title]), el('ul', {}, items.map(function (t) { return el('li', {}, [t]); }))])); };
    list('warn', 'Please confirm before publishing', d.warnings);
    list('miss', 'Missing information (add if you have it)', d.missingInformation);
    list('miss', 'Text detected on the product photos', d.detectedText);

    var row = el('div', { class: 'aip-row' }, [el('button', { class: 'aip-btn pri', type: 'button', onclick: function () { self._apply(); } }, ['Apply to form'])]);
    box.appendChild(row);
    box.appendChild(el('div', { class: 'aip-applied' }, [this.applied ? 'Applied to the form. Review the fields above, then press Save yourself. Nothing is published automatically.' : 'Nothing is saved until you apply it and press Save.']));
  };

  Pcx.AIProduct = AIProduct;
})(window);
