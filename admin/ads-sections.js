/* Admin: page section builder for an ad's brand page (used by ads.js).
 *
 * Section types: products (rail or grid), cards (feature cards), banner, video, text.
 * All fields are edited in place on the ad draft (`cur.page.sections`); ads.js binds the inputs by
 * their data-f path and mounts the image pickers by their data-pk path.
 *
 *   AdsSections.html(cur, { products, cats, esc })  -> markup
 *   AdsSections.act(action, el, cur, ctx)           -> true when the form needs re-rendering
 */
(function () {
  'use strict';

  var TYPES = { products: 'Products', cards: 'Feature cards', banner: 'Banner', video: 'Video', text: 'Text' };
  var opened = new WeakSet();   /* which sections are expanded (kept out of the saved data) */

  function defaults(type) {
    switch (type) {
      case 'products': return { type: type, title: '', layout: 'rail', mode: 'auto', category: '', limit: 12, ids: [], nav: true };
      case 'cards': return { type: type, items: [{ title: '', button: 'Buy Now', image: '', product_id: '', href: '' }] };
      case 'banner': return { type: type, image: '', product_id: '', href: '' };
      case 'video': return { type: type, url: '' };
      default: return { type: 'text', title: '', body: '' };
    }
  }

  function summary(s) {
    switch (s.type) {
      case 'products': return s.title || 'Untitled products';
      case 'cards': return (s.items || []).length + ' card' + ((s.items || []).length === 1 ? '' : 's');
      case 'banner': return s.image ? 'Image added' : 'No image yet';
      case 'video': return s.url || 'No link yet';
      default: return s.title || 'Text block';
    }
  }

  function html(cur, ctx) {
    var esc = ctx.esc, products = ctx.products;
    var secs = cur.page.sections;

    function inp(label, path, attrs, extra) {
      return '<div class="fg"><label>' + esc(label) + '</label><input data-f="' + esc(path) + '" value="' + esc(AdsAdmin.getp(cur, path)) + '" ' + (attrs || '') + (extra || '') + '></div>';
    }
    function sel(label, path, options, cur_, re) {
      return '<div class="fg"><label>' + esc(label) + '</label><select data-f="' + esc(path) + '"' + (re ? ' data-re="1"' : '') + '>' +
        options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur_ == null ? '' : cur_) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
        '</select></div>';
    }
    function prodSel(label, path, val) {
      var opts = [['', 'None']].concat(products.map(function (p) { return [p.id, p.name]; }));
      return sel(label, path, opts, val);
    }

    function body(s, i) {
      var base = 'page.sections.' + i;
      if (s.type === 'products') {
        var out = inp('Section title', base + '.title', 'type="text" placeholder="e.g. Best Sellers"', ' data-sum="1"') +
          '<div class="row2">' +
            sel('Layout', base + '.layout', [['rail', 'Sliding row'], ['grid', 'Grid']], s.layout) +
            sel('Products', base + '.mode', [['auto', 'Brand products'], ['manual', 'Pick products']], s.mode, true) +
          '</div>';
        if (s.mode === 'manual') {
          out += '<div class="fg"><button class="abtn" data-a="pick" data-i="' + i + '">Choose products (' + (s.ids || []).length + ' selected)</button></div>';
        } else {
          out += '<div class="row2">' +
            (ctx.catOptions && ctx.catOptions.length
              ? sel('Category', base + '.categoryId', [['', 'All categories']].concat(ctx.catOptions.map(function (c) { return [c.id, c.label]; })), s.categoryId)
              : inp('Category', base + '.category', 'type="text" placeholder="All (or e.g. Cosmetics)"')) +
            inp('Keyword', base + '.keyword', 'type="text" placeholder="e.g. skincare, cream"') +
          '</div><div class="row2">' +
            inp('Discount at least (%)', base + '.discountMin', 'type="number" min="0" max="95" placeholder="e.g. 20"') +
            inp('Max price', base + '.priceMax', 'type="number" min="0" placeholder="optional"') +
          '</div><div class="row2">' +
            sel('Only', base + '.flag', [['', 'All products'], ['flash', 'Flash sale'], ['featured', 'Featured']], s.flag) +
            sel('Sort by', base + '.sort', [['', 'Newest'], ['discount', 'Biggest discount'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']], s.sort) +
          '</div><div class="fg"><label>Max products</label><input type="number" min="1" data-f="' + base + '.limit" value="' + esc(s.limit || 12) + '"></div>';
        }
        out += '<div class="tgl-row"><label>Show in the menu links</label><div class="tgl' + (s.nav !== false ? ' on' : '') + '" data-tgl-sec="' + i + '"><div class="tgl-k"></div></div></div>';
        return out;
      }
      if (s.type === 'cards') {
        var items = (s.items || []).map(function (it, j) {
          var b = base + '.items.' + j;
          return '<div class="sec-item">' +
            inp('Card title', b + '.title', 'type="text" placeholder="e.g. S Series"') +
            '<div class="fg"><label>Image</label><div data-pk="' + b + '.image" data-max="1" data-label="Add image"></div></div>' +
            '<div class="row2">' + inp('Button text', b + '.button', 'type="text" placeholder="Buy Now"') + prodSel('Opens product', b + '.product_id', it.product_id) + '</div>' +
            inp('Or open a link', b + '.href', 'type="text" placeholder="https://..."') +
            '<button class="abtn danger" data-a="card-del" data-i="' + i + '" data-j="' + j + '">Remove card</button></div>';
        }).join('');
        return items + '<div class="fg"><button class="abtn" data-a="card-add" data-i="' + i + '">+ Add card</button></div>';
      }
      if (s.type === 'banner') {
        return '<div class="fg"><label>Banner image (full width)</label><div data-pk="' + base + '.image" data-max="1" data-label="Add banner"></div></div>' +
          prodSel('Opens product', base + '.product_id', s.product_id) + inp('Or open a link', base + '.href', 'type="text" placeholder="https://..."');
      }
      if (s.type === 'video') {
        return inp('YouTube link', base + '.url', 'type="url" placeholder="https://youtu.be/..."') +
          '<div class="ad-hint" style="margin:-4px 0 10px">Shows a thumbnail with a play button; the video loads when tapped.</div>';
      }
      return inp('Heading', base + '.title', 'type="text" placeholder="e.g. Your trusted destination for Oraimo"', ' data-sum="1"') +
        '<div class="fg"><label>Text</label><textarea data-f="' + base + '.body" rows="7" placeholder="Leave a blank line between paragraphs. Wrap words in **double stars** to make them bold.">' + esc(s.body || '') + '</textarea></div>';
    }

    var list = secs.length ? secs.map(function (s, i) {
      var open = opened.has(s);
      return '<div class="sec-card"><div class="sec-hd">' +
        '<span class="sec-type">' + TYPES[s.type] + '</span><span class="sec-sum">' + esc(summary(s)) + '</span>' +
        '<div class="sec-btns">' +
          '<button data-a="sec-up" data-i="' + i + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
          '<button data-a="sec-down" data-i="' + i + '" aria-label="Move down"' + (i === secs.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
          '<button data-a="sec-toggle" data-i="' + i + '">' + (open ? 'Close' : 'Edit') + '</button>' +
          '<button data-a="sec-del" data-i="' + i + '" aria-label="Delete">&times;</button>' +
        '</div></div>' + (open ? '<div class="sec-body">' + body(s, i) + '</div>' : '') + '</div>';
    }).join('') : '<div class="ad-empty">No sections yet. Without any, the page shows every product from the brand in a grid.</div>';

    return list + '<div class="sec-add">' + Object.keys(TYPES).map(function (t) {
      return '<button data-a="sec-add" data-type="' + t + '">+ ' + TYPES[t] + '</button>';
    }).join('') + '</div>';
  }

  /* ── product chooser (bottom sheet) ── */

  function openPicker(products, selected, onDone) {
    var box = document.getElementById('adPick');
    if (!box) {
      box = document.createElement('div');
      box.id = 'adPick';
      box.innerHTML = '<div id="adPickBox"><div id="adPickHd">Choose products</div>' +
        '<input id="adPickQ" type="search" placeholder="Search products"><div id="adPickList"></div>' +
        '<div id="adPickFoot"><button class="btn-s" id="adPickCancel">Cancel</button><button class="btn-p" id="adPickDone">Done</button></div></div>';
      document.body.appendChild(box);
    }
    var order = selected.slice();
    var list = box.querySelector('#adPickList'), q = box.querySelector('#adPickQ'), hd = box.querySelector('#adPickHd');
    var esc = AdsAdmin.esc;

    function draw() {
      var term = q.value.trim().toLowerCase();
      var rows = products.filter(function (p) { return !term || (p.name || '').toLowerCase().indexOf(term) !== -1 || (p.brand || '').toLowerCase().indexOf(term) !== -1; });
      list.innerHTML = rows.map(function (p) {
        return '<label class="pk-row">' + (p.image_url ? '<img src="' + safeUrl(p.image_url) + '" alt="">' : '<span class="pk-ph"></span>') +
          '<span class="pk-name">' + esc(p.name) + '<div class="pk-price">' + esc(p.brand || '') + '</div></span>' +
          '<input type="checkbox" data-id="' + esc(p.id) + '"' + (order.indexOf(p.id) !== -1 ? ' checked' : '') + '></label>';
      }).join('') || '<div class="ad-empty" style="margin:8px">No products found.</div>';
      hd.textContent = 'Choose products (' + order.length + ')';
    }
    list.onchange = function (e) {
      var id = Number(e.target.dataset.id), at = order.indexOf(id);
      if (e.target.checked && at === -1) order.push(id); else if (!e.target.checked && at !== -1) order.splice(at, 1);
      hd.textContent = 'Choose products (' + order.length + ')';
    };
    q.value = ''; q.oninput = draw;
    box.querySelector('#adPickCancel').onclick = function () { box.classList.remove('on'); };
    box.querySelector('#adPickDone').onclick = function () { box.classList.remove('on'); onDone(order); };
    draw();
    box.classList.add('on');
  }

  /* ── actions ── */

  function act(a, el, cur, ctx) {
    var secs = cur.page.sections, i = parseInt(el.dataset.i, 10), j = parseInt(el.dataset.j, 10);
    switch (a) {
      case 'sec-add': var n = defaults(el.dataset.type); secs.push(n); opened.add(n); return true;
      case 'sec-toggle': if (opened.has(secs[i])) opened.delete(secs[i]); else opened.add(secs[i]); return true;
      case 'sec-del': secs.splice(i, 1); return true;
      case 'sec-up': if (i > 0) { var t = secs[i]; secs[i] = secs[i - 1]; secs[i - 1] = t; } return true;
      case 'sec-down': if (i < secs.length - 1) { var u = secs[i]; secs[i] = secs[i + 1]; secs[i + 1] = u; } return true;
      case 'card-add': secs[i].items.push({ title: '', button: 'Buy Now', image: '', product_id: '', href: '' }); return true;
      case 'card-del': secs[i].items.splice(j, 1); return true;
      case 'pick':
        openPicker(ctx.products, (secs[i].ids || []).map(Number), function (ids) { secs[i].ids = ids; AdsAdmin.rerender(); });
        return false;
      default: return false;
    }
  }

  /* the "show in menu" switch lives inside a section, so it has its own tiny handler */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-tgl-sec]');
    if (!t) return;
    t.classList.toggle('on');
    var draft = window.__adsDraft && window.__adsDraft();
    if (draft) draft.page.sections[parseInt(t.dataset.tglSec, 10)].nav = t.classList.contains('on');
  });

  window.AdsSections = { html: html, act: act, pickProducts: openPicker };
})();
