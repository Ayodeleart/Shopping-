/* Admin: "When tapped, open" picker, shared by hero banners and square GIF tiles.
 *
 *   const dest = DestPicker.mount(containerEl);
 *   dest.read();          // -> target object for the `target` column (or null), throws a readable message when incomplete
 *   dest.write(target);   // show an existing target
 *   dest.reset();
 *
 * Destinations
 *   A brand's products            every product of a brand (brand logo on the page)
 *   Products matching filters     discount at least 30%, a category, a keyword, max price, flash sale...
 *   Products I choose             a hand picked list
 *   An ad page                    one of the ads from Banners > Ads
 *   A link                        any URL
 *
 * The target shapes are documented in data/ads.js. Needs: sb, Ads (data/ads.js), Pcx.Categories (data/categories.js),
 * AdsSections.pickProducts (ads-sections.js).
 */
(function () {
  'use strict';

  var TYPES = [
    ['', 'Nothing'],
    ['brand', "A brand's products"],
    ['collection', 'Products matching filters (deals, category...)'],
    ['products', 'Products I choose'],
    ['ad', 'An ad page'],
    ['url', 'A link']
  ];

  var data = { products: [], brands: [], ads: [], cats: [], catLabel: {} };
  var loaded = false, loading = null, instances = [];

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };

  function prepare() {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    loading = Promise.all([
      sb.from('products').select('id,name,brand,brand_id,category,category_id,description,price,original_price,flash_sale,featured,image_url,created_at').order('created_at', { ascending: false }),
      sb.from('brands').select('id,name,logo_url').order('name', { ascending: true }),
      sb.from('ads').select('id,name').order('sort_order', { ascending: true }),
      (window.Pcx && Pcx.Categories) ? Pcx.Categories.fetchAll(sb) : Promise.resolve({ rows: [] })
    ]).then(function (res) {
      data.products = res[0].data || [];
      data.brands = res[1].data || [];
      data.ads = res[2].data || [];
      var rows = (res[3] && res[3].rows) || [];
      if (rows.length) {
        var tree = new Pcx.Categories.Tree(rows);
        Ads.setCategoryResolver(function (id) { return tree.productMatcher(id); });
        var walk = function (nodes, out) {
          nodes.forEach(function (c) { out.push({ id: c.id, label: tree.label(c.id) }); walk(tree.visibleChildren(c.id), out); });
          return out;
        };
        data.cats = walk(tree.visibleRoots(), []);
        data.cats.forEach(function (c) { data.catLabel[c.id] = c.label; });
      }
      loaded = true;
    }).catch(function () { loaded = true; }).then(function () {
      loading = null;
      instances.forEach(function (i) { i.refresh(); });
    });
    return loading;
  }

  function describe(t) {
    if (!t || !t.type) return 'Not clickable';
    if (t.type === 'brand') return 'Brand: ' + (t.brand || '#' + t.brand_id);
    if (t.type === 'products') return (t.ids || []).length + ' chosen product' + ((t.ids || []).length === 1 ? '' : 's');
    if (t.type === 'ad') return 'Ad page #' + t.id;
    if (t.type === 'url') return t.url;
    var r = t.rule || [], bits = [];
    if (r.discountMin) bits.push(r.discountMin + '%+ off');
    if (r.categoryId) bits.push(data.catLabel[r.categoryId] || 'a category');
    if (r.category) bits.push(r.category);
    if (r.keyword) bits.push('"' + r.keyword + '"');
    if (r.priceMax) bits.push('under ' + r.priceMax);
    if (r.flag) bits.push(r.flag === 'flash' ? 'flash sale' : 'featured');
    return 'Page: ' + (bits.join(', ') || 'all products');
  }

  function mount(root) {
    var typeOpts = TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
    root.innerHTML =
      '<div class="fg"><label>When tapped, open</label><select data-k="type">' + typeOpts + '</select></div>' +

      '<div class="dest-box" data-box="brand" hidden>' +
        '<div class="fg"><label>Brand</label><select data-k="brand"><option value="">Choose a brand</option></select></div>' +
        '<div class="ad-hint" style="margin-bottom:10px">Opens a page with the brand logo and only that brand\'s products. Brands come from the products (vendors pick them when they upload).</div>' +
      '</div>' +

      '<div class="dest-box" data-box="collection" hidden>' +
        '<div class="fg"><label>Page title</label><input type="text" data-k="title" placeholder="e.g. 30% Off Deals"></div>' +
        '<div class="row2">' +
          '<div class="fg"><label>Discount at least (%)</label><input type="number" data-k="disc" min="0" max="95" placeholder="e.g. 30"></div>' +
          '<div class="fg"><label>Category</label><span data-k="catWrap"></span></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div class="fg"><label>Keyword</label><input type="text" data-k="key" placeholder="e.g. iphone, apple"></div>' +
          '<div class="fg"><label>Max price</label><input type="number" data-k="max" min="0" placeholder="optional"></div>' +
        '</div>' +
        '<div class="row2">' +
          '<div class="fg"><label>Only</label><select data-k="flag"><option value="">All products</option><option value="flash">Flash sale</option><option value="featured">Featured</option></select></div>' +
          '<div class="fg"><label>Sort by</label><select data-k="sort"><option value="">Newest</option><option value="discount">Biggest discount</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></div>' +
        '</div>' +
        '<div class="ad-match" data-k="match"></div>' +
        '<div class="ad-hint" style="margin-bottom:10px">Every product that fits all the filters you fill in is shown. Keyword accepts several words separated by commas. Leave everything empty to show every product.</div>' +
      '</div>' +

      '<div class="dest-box" data-box="products" hidden>' +
        '<div class="fg"><label>Page title</label><input type="text" data-k="ptitle" placeholder="e.g. Back to school picks"></div>' +
        '<div class="fg"><button type="button" class="abtn" data-k="choose">Choose products (0 selected)</button></div>' +
      '</div>' +

      '<div class="dest-box" data-box="ad" hidden>' +
        '<div class="fg"><label>Ad page</label><select data-k="ad"><option value="">Choose an ad</option></select></div>' +
      '</div>' +

      '<div class="dest-box" data-box="url" hidden>' +
        '<div class="fg"><label>Link</label><input type="text" data-k="url" placeholder="https://... or /page"></div>' +
      '</div>';

    var q = function (k) { return root.querySelector('[data-k="' + k + '"]'); };
    var box = function (k) { return root.querySelector('[data-box="' + k + '"]'); };
    var ids = [], pendingCat = null, pendingBrand = null, pendingAd = null;

    function num(k) { var v = parseFloat(q(k).value); return v > 0 ? v : undefined; }
    function txt(k) { var v = q(k).value.trim(); return v || undefined; }

    function readRule() {
      var rule = { discountMin: num('disc'), keyword: txt('key'), priceMax: num('max'), flag: txt('flag'), sort: txt('sort') };
      var cat = q('cat');
      if (cat) {
        if (cat.tagName === 'SELECT') { var id = parseInt(cat.value, 10); if (id) rule.categoryId = id; }
        else if (cat.value.trim()) rule.category = cat.value.trim();
      }
      Object.keys(rule).forEach(function (k) { if (rule[k] === undefined) delete rule[k]; });
      return rule;
    }

    function updateMatch() {
      var el = q('match');
      if (!el) return;
      if (!loaded) { el.textContent = ''; return; }
      var n = Ads.matchRule(data.products, readRule()).length;
      el.textContent = n + ' product' + (n === 1 ? '' : 's') + ' match' + (n === 1 ? 'es' : '') + ' right now';
      el.className = 'ad-match' + (n ? '' : ' none');
    }

    function refresh() {
      /* category: a tree select when categories exist, otherwise a plain text box */
      var wrap = q('catWrap'), keepCat = q('cat') ? q('cat').value : (pendingCat != null ? pendingCat : '');
      wrap.innerHTML = data.cats.length
        ? '<select data-k="cat"><option value="">All categories</option>' + data.cats.map(function (c) { return '<option value="' + c.id + '">' + esc(c.label) + '</option>'; }).join('') + '</select>'
        : '<input type="text" data-k="cat" placeholder="e.g. Cosmetics">';
      q('cat').value = keepCat;
      pendingCat = null;

      var bs = q('brand'), keepB = bs.value || pendingBrand || '';
      bs.innerHTML = '<option value="">Choose a brand</option>' + data.brands.map(function (b) { return '<option value="' + b.id + '" data-name="' + esc(b.name) + '">' + esc(b.name) + '</option>'; }).join('');
      if (keepB && !bs.querySelector('option[value="' + keepB + '"]')) bs.insertAdjacentHTML('beforeend', '<option value="' + esc(keepB) + '">Brand #' + esc(keepB) + '</option>');
      bs.value = keepB; pendingBrand = null;

      var as = q('ad'), keepA = as.value || pendingAd || '';
      as.innerHTML = '<option value="">Choose an ad</option>' + data.ads.map(function (a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; }).join('');
      if (keepA && !as.querySelector('option[value="' + keepA + '"]')) as.insertAdjacentHTML('beforeend', '<option value="' + esc(keepA) + '">Ad #' + esc(keepA) + '</option>');
      as.value = keepA; pendingAd = null;
      updateMatch();
    }

    function show() {
      var v = q('type').value;
      ['brand', 'collection', 'products', 'ad', 'url'].forEach(function (k) { box(k).hidden = k !== v; });
      if (v === 'brand' || v === 'collection' || v === 'products' || v === 'ad') prepare();
      updateMatch();
    }

    function read() {
      var v = q('type').value;
      if (v === 'brand') {
        var sel = q('brand'), id = parseInt(sel.value, 10);
        if (!id) throw new Error('Choose which brand it opens');
        var opt = sel.options[sel.selectedIndex];
        return { type: 'brand', brand_id: id, brand: (opt && opt.dataset.name) || '' };
      }
      if (v === 'collection') return { type: 'collection', title: txt('title') || 'Deals', rule: readRule() };
      if (v === 'products') {
        if (!ids.length) throw new Error('Choose at least one product');
        return { type: 'products', title: txt('ptitle') || 'Picked for you', ids: ids.slice() };
      }
      if (v === 'ad') {
        var ad = parseInt(q('ad').value, 10);
        if (!ad) throw new Error('Choose which ad page it opens');
        return { type: 'ad', id: ad };
      }
      if (v === 'url') {
        var url = q('url').value.trim();
        if (!url) throw new Error('Enter the link it opens');
        return { type: 'url', url: url };
      }
      return null;
    }

    function reset() {
      ['title', 'disc', 'key', 'max', 'ptitle', 'url'].forEach(function (k) { q(k).value = ''; });
      ['flag', 'sort', 'brand', 'ad', 'type'].forEach(function (k) { q(k).value = ''; });
      if (q('cat')) q('cat').value = '';
      ids = []; pendingCat = pendingBrand = pendingAd = null;
      q('choose').textContent = 'Choose products (0 selected)';
      show();
    }

    function write(t) {
      reset();
      if (!t || !t.type) return;
      q('type').value = t.type;
      if (t.type === 'collection') {
        var r = t.rule || {};
        q('title').value = t.title || '';
        q('disc').value = r.discountMin || ''; q('key').value = r.keyword || ''; q('max').value = r.priceMax || '';
        q('flag').value = r.flag || ''; q('sort').value = r.sort || '';
        pendingCat = r.categoryId || r.category || '';
        if (q('cat')) { if (q('cat').tagName === 'SELECT' && r.categoryId && !q('cat').querySelector('option[value="' + r.categoryId + '"]')) q('cat').insertAdjacentHTML('beforeend', '<option value="' + esc(r.categoryId) + '">Category #' + esc(r.categoryId) + '</option>'); q('cat').value = pendingCat; }
      } else if (t.type === 'brand') { pendingBrand = String(t.brand_id || ''); refresh(); }
      else if (t.type === 'products') {
        q('ptitle').value = t.title || ''; ids = (t.ids || []).map(Number);
        q('choose').textContent = 'Choose products (' + ids.length + ' selected)';
      } else if (t.type === 'ad') { pendingAd = String(t.id || ''); refresh(); }
      else if (t.type === 'url') q('url').value = t.url || '';
      show();
    }

    root.addEventListener('change', function (e) { if (e.target === q('type')) show(); else updateMatch(); });
    root.addEventListener('input', function () { updateMatch(); });
    q('choose').addEventListener('click', function () {
      prepare().then(function () {
        AdsSections.pickProducts(data.products, ids, function (picked) {
          ids = picked; q('choose').textContent = 'Choose products (' + ids.length + ' selected)';
        });
      });
    });

    var api = { read: read, write: write, reset: reset, refresh: refresh };
    instances.push(api);
    refresh();
    show();
    return api;
  }

  window.DestPicker = { mount: mount, describe: describe, prepare: prepare, data: data };

  /* the hero banner form has its own instance */
  var bannerMount = document.getElementById('bDestMount');
  if (bannerMount) window.BannerDest = mount(bannerMount);
})();
