/* Pcx.ProductAttributes + Pcx.DescriptionBlocks
 * Category-driven product details for the vendor (and later admin) product form.
 *
 * HOW IT WORKS
 *  - Every product has a "product type" (Clothing, Shoes, Electronics ...). It is guessed from the category name,
 *    and the vendor can change it, so odd category names ("Others", "New arrivals") still work.
 *  - The type decides which extra fields show (sizes, colours, about, specs ...).
 *  - EVERY type also gets "Extra details" (free name/value rows) and a full description with text + photos, so
 *    anything you did not plan for can still be described.
 *  - Saved as JSON:  products.attributes  and  products.description_blocks  (see migration_product_attributes.sql)
 *
 * ADD A NEW PRODUCT TYPE: add one entry to TEMPLATES below (fields + optional rules) and one regex to DETECT.
 *
 *   const attrs = new Pcx.ProductAttributes(el);
 *   attrs.setCategory('Shoes');        // auto-picks the type (unless the vendor picked one by hand)
 *   attrs.load(product.attributes, product.category);
 *   attrs.validate();                  // -> error message string, or null
 *   attrs.collect();                   // -> object to save into products.attributes
 *   attrs.clear();
 *
 *   const blocks = new Pcx.DescriptionBlocks(el2);
 *   blocks.setBlocks(product.description_blocks);
 *   await blocks.resolve(file => uploadFn(file));   // uploads pending photos, returns the array to save
 *   blocks.clear();
 *
 *   Pcx.ProductAttributes.summarize(attributes)      // -> [{label, value}] for the storefront product page
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  /* ------------------------------------------------------------------ option lists */
  function range(a, b, step) {
    var out = [];
    for (var i = a; i <= b; i += (step || 1)) out.push(String(i));
    return out;
  }

  var LETTER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
  var KIDS_AGE = ['0-3 months', '3-6 months', '6-12 months', '1-2 years', '2-3 years', '3-4 years', '5-6 years',
                  '7-8 years', '9-10 years', '11-12 years', '13-14 years'];

  var COLORS = {
    Black: '#111111', White: '#ffffff', Grey: '#9ca3af', 'Charcoal': '#374151', Red: '#dc2626', Maroon: '#7f1d1d',
    Pink: '#ec4899', 'Hot Pink': '#db2777', Orange: '#f97316', Peach: '#ffcba4', Yellow: '#facc15', Mustard: '#c9a227',
    Lime: '#84cc16', Green: '#16a34a', 'Olive': '#556b2f', Teal: '#0d9488', Turquoise: '#14b8a6', Blue: '#2563eb',
    'Sky Blue': '#38bdf8', Navy: '#1e3a5f', Indigo: '#4338ca', Purple: '#7c3aed', Lavender: '#c4b5fd', Brown: '#7c4a21',
    Tan: '#c19a6b', Beige: '#d6c3a3', Cream: '#f5ecd7', Khaki: '#bdb76b', Gold: '#d4af37', Silver: '#c0c0c0',
    Bronze: '#8c5e2a', Denim: '#3b5b7a', Coral: '#ff7f50', Mint: '#98ff98', Burgundy: '#800020',
    Multicolor: 'linear-gradient(135deg,#ef4444,#facc15,#22c55e,#3b82f6)'
  };
  var COLOR_NAMES = Object.keys(COLORS);

  var CONDITION = ['Brand new', 'Used - like new', 'Used - good', 'Used - fair', 'Refurbished'];
  var GENDER = ['Men', 'Women', 'Unisex', 'Boys', 'Girls'];

  /* ------------------------------------------------------------------ field shortcuts */
  var colors = function (req) {   // colours are never forced: not every product has one
    return { key: 'colors', label: 'Colours', type: 'colors', required: !!req, options: COLOR_NAMES,
             hint: 'Tap every colour you have. Not listed? Add your own.' };
  };
  var gender = { key: 'gender', label: 'For', type: 'select', options: GENDER };
  var material = function (ph) { return { key: 'material', label: 'Material', type: 'text', placeholder: ph || 'e.g. Cotton' }; };
  var condition = { key: 'condition', label: 'Condition', type: 'select', options: CONDITION };

  /* ------------------------------------------------------------------ product types */
  var TEMPLATES = {
    general: {
      label: 'General / other',
      fields: [
        condition,
        { key: 'size', label: 'Size / dimensions (if any)', type: 'text', placeholder: 'e.g. 30 x 20 cm' },
        material(),
        colors(false)
      ]
    },

    clothing: {
      label: 'Clothing',
      fields: [
        { key: 'sizes', label: 'Sizes', type: 'sizes', required: true,
          hint: 'Pick a size system, then tap every size you have.',
          systems: {
            'Letter (XS-XXL)': LETTER,
            'UK number': range(6, 30, 2),
            'US number': range(0, 26, 2),
            'Kids age': KIDS_AGE,
            'One size': ['Free size']
          } },
        colors(false),
        gender,
        material('e.g. Cotton, Ankara, Lace'),
        { key: 'care', label: 'Care instructions', type: 'text', placeholder: 'e.g. Hand wash, do not bleach' }
      ]
    },

    bottoms: {
      label: 'Trousers, jeans, shorts, skirts',
      fields: [
        { key: 'waist', label: 'Waist size (inches)', type: 'chips', options: range(26, 46, 2), allowCustom: true,
          hint: 'Odd sizes such as 31 can be added below.' },
        { key: 'length', label: 'Length / inseam (inches)', type: 'chips', options: ['26', '28', '30', '32', '34', '36'], allowCustom: true },
        { key: 'sizes', label: 'Or letter / number sizes', type: 'sizes',
          systems: { 'Letter (XS-XXL)': LETTER, 'UK number': range(6, 30, 2), 'US number': range(0, 26, 2) } },
        colors(false),
        gender,
        material('e.g. Denim, Linen')
      ],
      rules: function (a) {
        if (!has(a, 'waist') && !has(a, 'sizes')) return 'Add at least one waist size, or one letter / number size';
      }
    },

    bras: {
      label: 'Bras & underwear',
      fields: [
        { key: 'band', label: 'Band size', type: 'sizes',
          hint: 'For bras with cups. Skip for bralettes and pants.',
          systems: { 'UK / US band': range(28, 48, 2), 'EU band': range(65, 110, 5) } },
        { key: 'cups', label: 'Cup sizes', type: 'chips',
          options: ['AA', 'A', 'B', 'C', 'D', 'DD', 'E', 'F', 'FF', 'G', 'GG', 'H'], allowCustom: true },
        { key: 'sizes', label: 'Letter sizes (bralettes, pants)', type: 'sizes', systems: { 'Letter (XS-XXL)': LETTER } },
        colors(false),
        material('e.g. Cotton, Lace'),
        { key: 'style', label: 'Style', type: 'select',
          options: ['Padded', 'Non-padded', 'Push-up', 'Wired', 'Wireless', 'Sports bra', 'Bralette', 'Shapewear'] }
      ],
      rules: function (a) {
        if (!has(a, 'band') && !has(a, 'sizes')) return 'Add band + cup sizes, or letter sizes';
        if (has(a, 'band') && !has(a, 'cups')) return 'Pick at least one cup size for the band sizes you chose';
      }
    },

    shoes: {
      label: 'Shoes & footwear',
      fields: [
        { key: 'sizes', label: 'Shoe sizes', type: 'sizes', required: true,
          hint: 'Choose EU, UK or US first, then tap every size you have. Half sizes can be added.',
          systems: {
            'EU': range(34, 48),
            'UK': range(1, 13),
            'US Men': range(6, 15),
            'US Women': range(4, 13)
          } },
        colors(false),
        gender,
        material('e.g. Leather, Canvas, Rubber')
      ]
    },

    bags: {
      label: 'Bags & wallets',
      fields: [
        colors(false),
        material('e.g. Leather, Canvas'),
        { key: 'dimensions', label: 'Size (L x W x H, cm)', type: 'text', placeholder: 'e.g. 30 x 20 x 10' },
        condition
      ]
    },

    electronics: {
      label: 'Electronics & gadgets',
      fields: [
        condition,
        { key: 'model', label: 'Model', type: 'text', placeholder: 'e.g. A2894' },
        { key: 'warranty', label: 'Warranty', type: 'select',
          options: ['No warranty', '1 month', '3 months', '6 months', '1 year', '2 years', 'Manufacturer warranty'] },
        colors(false),
        { key: 'about', label: 'About this item', type: 'bullets', required: true,
          placeholder: 'e.g. 20W fast charging, works with all phones',
          hint: 'Key selling points, one per line. Buyers read these first.' },
        { key: 'specs', label: 'Specifications', type: 'specs',
          suggest: ['Screen size', 'RAM', 'Storage', 'Processor', 'Battery', 'Camera', 'Connectivity', 'Power', 'Voltage',
                    'Weight', 'Dimensions', 'Operating system'],
          hint: 'Name and value, e.g. RAM - 8GB.' },
        { key: 'inBox', label: "What's in the box", type: 'text', placeholder: 'e.g. Charger, cable, manual' }
      ]
    },

    beauty: {
      label: 'Beauty & skincare',
      fields: [
        { key: 'volume', label: 'Size / volume', type: 'text', placeholder: 'e.g. 250ml' },
        { key: 'shade', label: 'Shade / scent', type: 'text', placeholder: 'e.g. Rose, Vanilla' },
        { key: 'skinType', label: 'Skin type', type: 'chips',
          options: ['All skin types', 'Oily', 'Dry', 'Combination', 'Sensitive'] },
        { key: 'ingredients', label: 'Ingredients', type: 'textarea' },
        { key: 'expiry', label: 'Expiry date', type: 'date' },
        { key: 'nafdac', label: 'NAFDAC reg. no. (if any)', type: 'text' }
      ]
    },

    hair: {
      label: 'Hair, wigs & extensions',
      fields: [
        { key: 'hairType', label: 'Hair type', type: 'select', options: ['Human hair', 'Synthetic', 'Human hair blend'] },
        { key: 'length', label: 'Length (inches)', type: 'chips', required: true, options: range(8, 40, 2), allowCustom: true },
        { key: 'texture', label: 'Texture', type: 'chips',
          options: ['Straight', 'Body wave', 'Deep wave', 'Water wave', 'Curly', 'Kinky curly', 'Kinky straight'], allowCustom: true },
        { key: 'lace', label: 'Lace / cap', type: 'chips',
          options: ['Frontal', 'Closure', 'Full lace', '360 lace', 'Glueless', 'No lace / bundle'], allowCustom: true },
        { key: 'density', label: 'Density', type: 'chips', options: ['130%', '150%', '180%', '200%', '250%'], allowCustom: true },
        colors(false)
      ]
    },

    food: {
      label: 'Food & drinks',
      fields: [
        { key: 'weight', label: 'Weight / volume', type: 'text', required: true, placeholder: 'e.g. 500g, 1.5L' },
        { key: 'expiry', label: 'Expiry / best before', type: 'date' },
        { key: 'ingredients', label: 'Ingredients', type: 'textarea' },
        { key: 'nafdac', label: 'NAFDAC reg. no. (if any)', type: 'text' },
        { key: 'storage', label: 'Storage', type: 'text', placeholder: 'e.g. Keep refrigerated' }
      ]
    },

    home: {
      label: 'Home & furniture',
      fields: [
        condition,
        { key: 'dimensions', label: 'Dimensions (L x W x H, cm)', type: 'text' },
        material('e.g. Wood, Metal, Fabric'),
        colors(false),
        { key: 'assembly', label: 'Assembly', type: 'select', options: ['Ready assembled', 'Assembly required'] }
      ]
    }
  };

  /* first match wins, so order matters (bras before clothing, electronics before clothing, etc.).
     'general' entries are deliberate: fabrics, hats, belts ... sit under Fashion but have no sizes to ask for. */
  var DETECT = [
    ['electronics', /washing machines?/],
    ['general', /(fabric|textile|tailoring|\bbelts?\b|\bhats?\b|\bcaps?\b|sunglass|scarves|gloves|\bservices?\b|repair|tutoring|lessons|rentals?|leasing|\bproperty\b|\bproperties\b|software|licen[cs]es|equipment|\bmachines?\b|machinery|glassware|drinkware|food storage|water bottles|gadgets|caskets?|coffins?)/],
    ['bras', /\b(bras?|bralettes?|lingerie|underwear|innerwear|panties|briefs)\b/],
    ['bottoms', /\b(trousers?|jeans?|pants?|shorts|joggers?|leggings?|skirts?)\b/],
    ['shoes', /(shoe|sneaker|sandal|slipper|footwear|heels?\b|boots?\b|loafer|crocs|flip.?flop)/],
    ['hair', /(\bwigs?\b|\bweaves?\b|\bbraids?\b|human hair|hair extensions?)/],
    ['beauty', /(beauty|cosmetic|skin|make-?up|perfume|fragrance|lotion|cream|soap)/],
    ['bags', /\b(bags?|handbags?|purses?|wallets?|backpacks?|luggage|suitcases?)\b/],
    ['electronics', /(electronic|phone|laptop|computer|\btvs?\b|television|speaker|earphone|headphone|earbud|charger|appliance|camera|tablet|console|gaming|smart ?watch|wearables?|smart home|solar|inverters?|generators?|batter(y|ies)|stabilizers?|\bups\b|\bled\b|cctv|alarm)/],
    ['food', /(\bfoods?\b|grocer|\bdrinks\b|snack|beverage|spice|provision)/],
    ['home', /\b(home|furniture|kitchen|decor|bedding|curtains?|garden|household)\b/],
    ['clothing', /(cloth|fashion|wear|apparel|dress|shirt|\btops?\b|gown|jacket|hoodie|\btees?\b|ankara|\bnative\b|senator|kaftan|\bsuits?\b|uniform)/]
  ];

  function detectOne(name) {
    var c = String(name || '').toLowerCase();
    if (!c) return null;
    for (var i = 0; i < DETECT.length; i++) if (DETECT[i][1].test(c)) return DETECT[i][0];
    return null;
  }

  /* accepts one name, or a list from most to least specific (e.g. [subcategory, main category]) */
  function detectType(category) {
    var names = Array.isArray(category) ? category : [category];
    for (var i = 0; i < names.length; i++) {
      var t = detectOne(names[i]);
      if (t) return t;
    }
    return 'general';
  }

  /* ------------------------------------------------------------------ helpers */
  function has(a, key) {
    var v = a[key];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Array.isArray(v.values) ? v.values.length > 0 : Object.keys(v).length > 0;
    return String(v).trim() !== '';
  }

  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'src' || k === 'href') e.setAttribute(k, safeHref(v));       // a URL from the database is validated first
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function cleanPairs(arr) {
    return (Array.isArray(arr) ? arr : []).map(function (p) {
      return { k: String((p && p.k) || '').trim(), v: String((p && p.v) || '').trim() };
    }).filter(function (p) { return p.k && p.v; });
  }

  function cleanValue(f, v) {
    switch (f.type) {
      case 'chips': case 'colors':
        return Array.isArray(v) && v.length ? v.slice() : undefined;
      case 'sizes':
        return v && Array.isArray(v.values) && v.values.length ? { system: v.system, values: v.values.slice() } : undefined;
      case 'bullets': {
        var lines = (Array.isArray(v) ? v : []).map(function (s) { return String(s).trim(); }).filter(Boolean);
        return lines.length ? lines : undefined;
      }
      case 'specs': {
        var pairs = cleanPairs(v);
        return pairs.length ? pairs : undefined;
      }
      default: {
        var s = v == null ? '' : String(v).trim();
        return s ? s : undefined;
      }
    }
  }

  /* ------------------------------------------------------------------ chips (multi-select) */
  /* Same chip picker as chipGroup(), plus: for every selected colour, a row of the product's own already-uploaded
     photos so the vendor/admin can say "this photo IS the Black one" — no separate colour-photo upload, no fake
     images. cfg.colorImages is the {colourName: photoUrl} map, mutated in place (same object collect() reads). */
  function colorGroup(cfg) {
    var wrap = h('div');
    var list = h('div', { class: 'pa-chips' });
    var imgWrap = h('div', { class: 'pa-colorimgs' });
    wrap.appendChild(list); wrap.appendChild(imgWrap);

    function paintImages() {
      imgWrap.textContent = '';
      Object.keys(cfg.colorImages).forEach(function (c) { if (cfg.values.indexOf(c) < 0) delete cfg.colorImages[c]; }); // colour removed -> forget its photo
      if (!cfg.values.length) return;
      var photos = (cfg.getImages ? cfg.getImages() : []) || [];
      cfg.values.forEach(function (c) {
        var row = h('div', { class: 'pa-colorimg-row' });
        var lbl = h('div', { class: 'pa-colorimg-lbl' }, [
          h('span', { class: 'pa-dot', style: 'background:' + (cfg.swatches[c] || '#ccc') }), c + ' photo:'
        ]);
        row.appendChild(lbl);
        if (!photos.length) {
          row.appendChild(h('div', { class: 'pa-colorimg-hint' }, ['Add photos above, then tap one here to link it to ' + c]));
        } else {
          var thumbs = h('div', { class: 'pa-colorimg-thumbs' });
          photos.forEach(function (url) {
            var on = cfg.colorImages[c] === url;
            thumbs.appendChild(h('button', {
              type: 'button', class: 'pa-colorimg-thumb' + (on ? ' on' : ''), style: 'background-image:url(' + JSON.stringify(url).replace(/"/g, "'") + ')',
              'aria-pressed': on ? 'true' : 'false', 'aria-label': (on ? 'Unlink' : 'Link') + ' this photo from ' + c,
              onclick: function () { cfg.colorImages[c] = on ? null : url; if (!cfg.colorImages[c]) delete cfg.colorImages[c]; paintImages(); }
            }));
          });
          row.appendChild(thumbs);
        }
        imgWrap.appendChild(row);
      });
    }

    function paint() {
      list.textContent = '';
      var all = cfg.options.slice();
      cfg.values.forEach(function (v) { if (all.indexOf(v) < 0) all.push(v); });
      all.forEach(function (opt) {
        var on = cfg.values.indexOf(opt) >= 0;
        list.appendChild(h('button', {
          type: 'button', class: 'pa-chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: function () {
            var i = cfg.values.indexOf(opt);
            if (i >= 0) cfg.values.splice(i, 1); else cfg.values.push(opt);
            paint(); paintImages();
          }
        }, [h('span', { class: 'pa-dot', style: 'background:' + cfg.swatches[opt] }), opt]));
      });
    }
    paint(); paintImages();

    var inp = h('input', { type: 'text', maxlength: 30, placeholder: cfg.placeholder || 'Add your own' });
    var add = function () {
      var v = inp.value.trim();
      if (!v) return;
      var lower = v.toLowerCase();
      var existing = cfg.options.concat(cfg.values).filter(function (o) { return o.toLowerCase() === lower; })[0];
      var val = existing || v;
      if (cfg.values.indexOf(val) < 0) cfg.values.push(val);
      inp.value = '';
      paint(); paintImages();
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    wrap.appendChild(h('div', { class: 'pa-add' }, [inp, h('button', { type: 'button', class: 'pa-addbtn', onclick: add }, ['Add'])]));
    wrap.refresh = paintImages;      // called after new photos are uploaded (see refreshColorImages())
    return wrap;
  }

  function chipGroup(cfg) {
    var wrap = h('div');
    var list = h('div', { class: 'pa-chips' });
    wrap.appendChild(list);

    function paint() {
      list.textContent = '';
      var all = cfg.options.slice();
      cfg.values.forEach(function (v) { if (all.indexOf(v) < 0) all.push(v); });   // custom ones stay visible
      all.forEach(function (opt) {
        var on = cfg.values.indexOf(opt) >= 0;
        var kids = [];
        if (cfg.swatches && cfg.swatches[opt]) kids.push(h('span', { class: 'pa-dot', style: 'background:' + cfg.swatches[opt] }));
        kids.push(opt);
        list.appendChild(h('button', {
          type: 'button', class: 'pa-chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
          onclick: function () {
            var i = cfg.values.indexOf(opt);
            if (i >= 0) cfg.values.splice(i, 1); else cfg.values.push(opt);
            paint();
          }
        }, kids));
      });
    }
    paint();

    if (cfg.allowCustom) {
      var inp = h('input', { type: 'text', maxlength: 30, placeholder: cfg.placeholder || 'Add your own' });
      var add = function () {
        var v = inp.value.trim();
        if (!v) return;
        var lower = v.toLowerCase();
        var existing = cfg.options.concat(cfg.values).filter(function (o) { return o.toLowerCase() === lower; })[0];
        var val = existing || v;
        if (cfg.values.indexOf(val) < 0) cfg.values.push(val);
        inp.value = '';
        paint();
      };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      wrap.appendChild(h('div', { class: 'pa-add' }, [inp, h('button', { type: 'button', class: 'pa-addbtn', onclick: add }, ['Add'])]));
    }
    return wrap;
  }

  /* ------------------------------------------------------------------ ProductAttributes */
  /* opts.getImages(): () => string[] — the product's own already-uploaded photos (e.g. () => pPicker.getImages()),
     used only so the colours picker can link an existing photo to a colour. Optional: without it colours work exactly
     as before, just with no photo-linking row. */
  function ProductAttributes(root, opts) {
    this.root = root;
    this.o = Object.assign({ templates: TEMPLATES }, opts || {});
    this.uid = 'pa' + Math.random().toString(36).slice(2, 8);
    this.state = {};
    this.type = 'general';
    this.manualType = false;
    this._build();
  }
  var P = ProductAttributes.prototype;

  P._build = function () {
    var self = this;
    this.root.textContent = '';
    this.root.classList.add('pa');

    this.typeSel = h('select', { 'aria-label': 'Product type' });
    Object.keys(this.o.templates).forEach(function (k) {
      self.typeSel.appendChild(h('option', { value: k, text: self.o.templates[k].label }));
    });
    this.typeSel.value = this.type;
    this.typeSel.addEventListener('change', function () {
      self.manualType = true;
      self._setType(self.typeSel.value);
    });

    this.fieldsEl = h('div', { class: 'pa-fields' });
    this.extraEl = h('div', { class: 'pa-extra' });

    this.root.appendChild(h('div', { class: 'fld' }, [
      h('label', { text: 'Product type' }),
      this.typeSel,
      h('div', { class: 'pa-hint', text: 'Picked from your category. It decides which details you fill in below. Change it if it does not fit.' })
    ]));
    this.root.appendChild(this.fieldsEl);
    this.root.appendChild(this.extraEl);
    this._renderFields();
  };

  P.setCategory = function (name) {
    if (this.manualType) return;
    var t = detectType(name);
    if (t === this.type) return;
    this._setType(t);
  };

  /* switching type keeps only details that mean the same thing on every type; sizes, lengths etc. differ per type */
  var SHARED = ['colors', 'gender', 'material', 'condition', 'extra'];
  P._setType = function (t) {
    var keep = {};
    var old = this.state;
    SHARED.forEach(function (k) { if (old[k] != null) keep[k] = old[k]; });
    this.state = keep;
    this.type = t;
    this.typeSel.value = t;
    this._renderFields();
  };

  P.load = function (attrs, category) {
    attrs = attrs && typeof attrs === 'object' ? JSON.parse(JSON.stringify(attrs)) : {};
    var t = attrs._type;
    delete attrs._type;
    this.state = attrs;
    if (t && this.o.templates[t]) { this.type = t; this.manualType = true; }
    else { this.type = detectType(category); this.manualType = false; }
    this.typeSel.value = this.type;
    this._renderFields();
  };

  P.clear = function () {
    this.state = {};
    this.type = 'general';
    this.manualType = false;
    this.typeSel.value = this.type;
    this._renderFields();
  };

  P._renderFields = function () {
    var self = this;
    var t = this.o.templates[this.type] || this.o.templates.general;
    this.fieldsEl.textContent = '';
    t.fields.forEach(function (f) { self.fieldsEl.appendChild(self._field(f)); });

    this.extraEl.textContent = '';
    this.extraEl.appendChild(this._field({
      key: 'extra', label: 'Extra details (optional)', type: 'specs',
      suggest: ['Weight', 'Dimensions', 'Material', 'Country of origin', 'Warranty', 'Model'],
      hint: 'Anything else buyers should know that is not covered above. Name and value, e.g. Weight - 2kg.'
    }));
  };

  P._field = function (f) {
    var self = this;
    var control;
    switch (f.type) {
      case 'chips': {
        if (!Array.isArray(this.state[f.key])) this.state[f.key] = [];
        control = chipGroup({ options: f.options || [], values: this.state[f.key], allowCustom: !!f.allowCustom, placeholder: 'Other' });
        break;
      }
      case 'colors': {
        if (!Array.isArray(this.state[f.key])) this.state[f.key] = [];
        if (!this.state.colorImages || typeof this.state.colorImages !== 'object') this.state.colorImages = {};
        control = colorGroup({
          options: f.options || [], values: this.state[f.key], colorImages: this.state.colorImages,
          swatches: COLORS, placeholder: 'Other colour', getImages: self.o.getImages
        });
        self._colorCtl = control;
        break;
      }
      case 'sizes': control = this._sizes(f); break;
      case 'bullets': control = this._bullets(f); break;
      case 'specs': control = this._specs(f); break;
      case 'select': {
        var sel = h('select', {}, [h('option', { value: '', text: 'Select' })].concat(
          (f.options || []).map(function (o) { return h('option', { value: o, text: o }); })));
        sel.value = this.state[f.key] || '';
        sel.addEventListener('change', function () { self.state[f.key] = sel.value; });
        control = sel;
        break;
      }
      default: {
        var inp = f.type === 'textarea'
          ? h('textarea', { rows: 3, maxlength: 1000 })
          : h('input', { type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', maxlength: 120,
                         inputmode: f.type === 'number' ? 'decimal' : null });
        if (f.placeholder) inp.setAttribute('placeholder', f.placeholder);
        inp.value = this.state[f.key] || '';
        inp.addEventListener('input', function () { self.state[f.key] = inp.value; });
        control = inp;
      }
    }
    var label = h('label', {}, [f.label, f.required ? h('span', { class: 'pa-req', text: ' *' }) : null]);
    return h('div', { class: 'fld pa-fld' }, [label, control, f.hint ? h('div', { class: 'pa-hint', text: f.hint }) : null]);
  };

  P._sizes = function (f) {
    var st = this.state[f.key];
    var names = Object.keys(f.systems);
    if (!st || !Array.isArray(st.values)) st = this.state[f.key] = { system: names[0], values: [] };
    if (names.indexOf(st.system) < 0) {
      // saved with a system this type no longer lists: keep it rather than lose the vendor's data
      if (st.values.length) names.push(st.system); else st.system = names[0];
    }
    var wrap = h('div');
    var holder = h('div');
    function mount() {
      holder.textContent = '';
      holder.appendChild(chipGroup({ options: f.systems[st.system] || [], values: st.values, allowCustom: true, placeholder: 'Other size' }));
    }
    if (names.length > 1) {
      var sel = h('select', { class: 'pa-sys', 'aria-label': 'Size system' }, names.map(function (n) { return h('option', { value: n, text: n }); }));
      sel.value = st.system;
      sel.addEventListener('change', function () { st.system = sel.value; st.values = []; mount(); });
      wrap.appendChild(sel);
    }
    wrap.appendChild(holder);
    mount();
    return wrap;
  };

  P._bullets = function (f) {
    var arr = Array.isArray(this.state[f.key]) && this.state[f.key].length ? this.state[f.key] : (this.state[f.key] = ['']);
    var wrap = h('div');
    var list = h('div', { class: 'pa-rows' });
    function paint(focusIdx) {
      list.textContent = '';
      arr.forEach(function (val, i) {
        var inp = h('input', { type: 'text', maxlength: 200, placeholder: f.placeholder || '', value: val });
        inp.addEventListener('input', function () { arr[i] = inp.value; });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); arr.splice(i + 1, 0, ''); paint(i + 1); }
        });
        var del = h('button', { type: 'button', class: 'pa-x', 'aria-label': 'Remove line', onclick: function () {
          arr.splice(i, 1); if (!arr.length) arr.push(''); paint();
        } }, ['\u00d7']);
        list.appendChild(h('div', { class: 'pa-row' }, [inp, del]));
        if (focusIdx === i) setTimeout(function () { inp.focus(); }, 0);
      });
    }
    paint();
    wrap.appendChild(list);
    wrap.appendChild(h('button', { type: 'button', class: 'pa-addbtn pa-more', onclick: function () { arr.push(''); paint(arr.length - 1); } }, ['+ Add point']));
    return wrap;
  };

  P._specs = function (f) {
    var arr = Array.isArray(this.state[f.key]) && this.state[f.key].length ? this.state[f.key] : (this.state[f.key] = [{ k: '', v: '' }]);
    var listId = this.uid + '-' + f.key;
    var wrap = h('div');
    var list = h('div', { class: 'pa-rows' });
    if (f.suggest) wrap.appendChild(h('datalist', { id: listId }, f.suggest.map(function (s) { return h('option', { value: s }); })));
    function paint(focusIdx) {
      list.textContent = '';
      arr.forEach(function (p, i) {
        var k = h('input', { type: 'text', maxlength: 40, placeholder: 'Name', value: p.k, list: f.suggest ? listId : null });
        var v = h('input', { type: 'text', maxlength: 120, placeholder: 'Value', value: p.v });
        k.addEventListener('input', function () { p.k = k.value; });
        v.addEventListener('input', function () { p.v = v.value; });
        var del = h('button', { type: 'button', class: 'pa-x', 'aria-label': 'Remove row', onclick: function () {
          arr.splice(i, 1); if (!arr.length) arr.push({ k: '', v: '' }); paint();
        } }, ['\u00d7']);
        list.appendChild(h('div', { class: 'pa-row pa-spec' }, [k, v, del]));
        if (focusIdx === i) setTimeout(function () { k.focus(); }, 0);
      });
    }
    paint();
    wrap.appendChild(list);
    wrap.appendChild(h('button', { type: 'button', class: 'pa-addbtn pa-more', onclick: function () { arr.push({ k: '', v: '' }); paint(arr.length - 1); } }, ['+ Add detail']));
    return wrap;
  };

  P.collect = function () {
    var t = this.o.templates[this.type] || this.o.templates.general;
    var out = { _type: this.type };
    var state = this.state;
    t.fields.forEach(function (f) {
      var v = cleanValue(f, state[f.key]);
      if (v !== undefined) out[f.key] = v;
    });
    var extra = cleanPairs(state.extra);
    if (extra.length) out.extra = extra;
    if (state.colorImages && out.colors) {
      var ci = {};
      out.colors.forEach(function (c) { if (state.colorImages[c]) ci[c] = state.colorImages[c]; });
      if (Object.keys(ci).length) out.colorImages = ci;
    }
    return out;
  };

  /* Call after the product's photos change (a photo is added/removed/reordered in the picker) so the colour ->
     photo links stay pickable straight away, without needing to switch tabs and back. Harmless if colours aren't used. */
  P.refreshColorImages = function () { if (this._colorCtl && this._colorCtl.refresh) this._colorCtl.refresh(); };

  P.validate = function () {
    var t = this.o.templates[this.type] || this.o.templates.general;
    var a = this.collect();
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (f.required && !has(a, f.key)) {
        if (f.type === 'chips' || f.type === 'colors' || f.type === 'sizes') return 'Choose at least one option for "' + f.label + '"';
        if (f.type === 'bullets' || f.type === 'specs') return 'Add at least one line under "' + f.label + '"';
        return '"' + f.label + '" is required';
      }
    }
    return t.rules ? (t.rules(a) || null) : null;
  };

  /* Storefront helper: turn saved attributes into [{label, value}] rows (arrays joined, sizes prefixed with system). */
  ProductAttributes.summarize = function (attrs, templates) {
    templates = templates || TEMPLATES;
    if (!attrs || typeof attrs !== 'object') return [];
    var t = templates[attrs._type] || templates.general;
    var rows = [];
    t.fields.forEach(function (f) {
      var v = attrs[f.key];
      if (v == null || f.type === 'bullets') return;                 // bullets are shown as their own list
      if (f.type === 'sizes') rows.push({ label: f.label, value: (v.system ? v.system + ': ' : '') + (v.values || []).join(', ') });
      else if (f.type === 'specs') (v || []).forEach(function (p) { rows.push({ label: p.k, value: p.v }); });
      else if (Array.isArray(v)) rows.push({ label: f.label, value: v.join(', ') });
      else rows.push({ label: f.label, value: String(v) });
    });
    (attrs.extra || []).forEach(function (p) { rows.push({ label: p.k, value: p.v }); });
    return rows.filter(function (r) { return r.value; });
  };

  ProductAttributes.COLORS = COLORS;          // name -> CSS colour; the product page uses it for swatches (Pcx.Variants.swatch)
  ProductAttributes.detect = detectType;
  ProductAttributes.TEMPLATES = TEMPLATES;

  /* ------------------------------------------------------------------ DescriptionBlocks (text + photos) */
  function DescriptionBlocks(root, opts) {
    this.root = root;
    this.o = Object.assign({ maxBlocks: 30, maxImages: 10, onError: null }, opts || {});
    this.blocks = [];
    this._render();
  }
  var D = DescriptionBlocks.prototype;

  D.setBlocks = function (arr) {
    this._revoke();
    this.blocks = (Array.isArray(arr) ? arr : []).filter(function (b) { return b && b.type; }).map(function (b) {
      return b.type === 'image' ? { type: 'image', url: b.url } : { type: b.type === 'heading' ? 'heading' : 'text', text: b.text || '' };
    });
    this._render();
  };
  D.clear = function () { this.setBlocks([]); };
  /* puts `text` in the first text block (adds one at the top if there is none); photos and other blocks stay as they are */
  D.setText = function (text) {
    var b = null;
    for (var i = 0; i < this.blocks.length; i++) if (this.blocks[i].type === 'text') { b = this.blocks[i]; break; }
    if (b) b.text = String(text || ''); else this.blocks.unshift({ type: 'text', text: String(text || '') });
    this._render();
  };
  D._revoke = function () {
    this.blocks.forEach(function (b) { if (b.preview) { try { URL.revokeObjectURL(b.preview); } catch (e) {} } });
  };
  D._err = function (m) { if (this.o.onError) this.o.onError(m); };

  D._render = function () {
    var self = this;
    this.root.textContent = '';
    this.root.classList.add('pd');
    var list = h('div', { class: 'pd-list' });
    this.blocks.forEach(function (b, i) {
      var body;
      if (b.type === 'image') {
        body = h('img', { class: 'pd-img', src: b.preview || b.url, alt: '' });
      } else if (b.type === 'heading') {
        body = h('input', { type: 'text', maxlength: 80, placeholder: 'Heading, e.g. Key features', value: b.text });
        body.addEventListener('input', function () { b.text = body.value; });
      } else {
        body = h('textarea', { rows: 4, maxlength: 2000, placeholder: 'Write about the product...' });
        body.value = b.text;
        body.addEventListener('input', function () { b.text = body.value; });
      }
      var move = function (d) {
        var j = i + d;
        if (j < 0 || j >= self.blocks.length) return;
        var t = self.blocks[i]; self.blocks[i] = self.blocks[j]; self.blocks[j] = t;
        self._render();
      };
      var tools = h('div', { class: 'pd-tools' }, [
        h('button', { type: 'button', 'aria-label': 'Move up', onclick: function () { move(-1); } }, ['\u2191']),
        h('button', { type: 'button', 'aria-label': 'Move down', onclick: function () { move(1); } }, ['\u2193']),
        h('button', { type: 'button', 'aria-label': 'Remove', onclick: function () {
          if (b.preview) { try { URL.revokeObjectURL(b.preview); } catch (e) {} }
          self.blocks.splice(i, 1); self._render();
        } }, ['\u00d7'])
      ]);
      list.appendChild(h('div', { class: 'pd-block pd-' + b.type }, [body, tools]));
    });
    this.root.appendChild(list);

    var file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type)) { self._err('Please choose an image file'); return; }
      self.blocks.push({ type: 'image', file: f, preview: URL.createObjectURL(f) });
      self._render();
    });
    var count = function (t) { return self.blocks.filter(function (b) { return b.type === t; }).length; };
    var add = function (type) {
      if (self.blocks.length >= self.o.maxBlocks) { self._err('That is the most blocks a description can have'); return; }
      self.blocks.push({ type: type, text: '' });
      self._render();
    };
    this.root.appendChild(h('div', { class: 'pd-add' }, [
      h('button', { type: 'button', onclick: function () { add('heading'); } }, ['+ Heading']),
      h('button', { type: 'button', onclick: function () { add('text'); } }, ['+ Text']),
      h('button', { type: 'button', onclick: function () {
        if (count('image') >= self.o.maxImages) { self._err('Up to ' + self.o.maxImages + ' photos in the description'); return; }
        file.click();
      } }, ['+ Photo']),
      file
    ]));
  };

  D.hasPending = function () { return this.blocks.some(function (b) { return b.type === 'image' && b.file; }); };

  /* uploads photos that are still local, returns the array to store in products.description_blocks */
  D.resolve = async function (uploadFn) {
    var out = [];
    for (var i = 0; i < this.blocks.length; i++) {
      var b = this.blocks[i];
      if (b.type === 'image') {
        if (b.file) { b.url = await uploadFn(b.file); b.file = null; }   // upload once; if a later step fails the retry reuses this url
        if (b.url) out.push({ type: 'image', url: b.url });
      } else {
        var s = String(b.text || '').trim();
        if (s) out.push({ type: b.type, text: s });
      }
    }
    return out;
  };

  Pcx.ProductAttributes = ProductAttributes;
  Pcx.DescriptionBlocks = DescriptionBlocks;
})(window);
