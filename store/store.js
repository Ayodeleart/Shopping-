/* /store/store.js
 * Public seller storefront (/store/[slug]).
 *
 * Reuses:
 *  - the existing `vendors` / `products` / `product_ratings` tables and their
 *    existing RLS policies (no new tables, no new API, no mock data)
 *  - components/product-card.js + product-card.css for the product grid
 *    (same cards as the main marketplace, not a second implementation)
 *  - components/seller-brand.js for the seller identity chip
 *  - the existing checkout: tapping a product goes to /?p=ID, which
 *    index.html already opens as the real product modal with the real
 *    cart/checkout flow. This page never implements its own checkout.
 *  - the existing cart storage key (`cart_v3` in localStorage) so items
 *    added here show up in the same cart on the homepage.
 */
(function () {
  'use strict';

  const SB_URL = 'https://qmwlphribvncdtgzbixt.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtd2xwaHJpYnZuY2R0Z3piaXh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMDkwMjcsImV4cCI6MjA5NTg4NTAyN30.kmXKSrnQxG6n8RdK6ppNvn05vi7Xl68LKUNW5f7CQCU';
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

  const PAGE_SIZE = 24;
  const $ = id => document.getElementById(id);

  /* ── THEME (matches the main app's saved preference) ─────────── */
  const dark = localStorage.getItem('theme') === 'dark' ||
    (!localStorage.getItem('theme') && matchMedia('(prefers-color-scheme:dark)').matches);
  document.body.dataset.theme = dark ? 'dark' : 'light';

  /* ── GLOBAL STATE product-card.js expects to find ─────────────── */
  window.currency = '₦';
  window.fmt = n => (window.esc ? window.esc(window.currency) : window.currency) + Number(n).toLocaleString('en-NG');
  window.ratingMap = {};
  try { window.cart = JSON.parse(localStorage.getItem('cart_v3')) || []; } catch (e) { window.cart = []; }
  try { window.favs = new Set((JSON.parse(localStorage.getItem('favs_v1')) || []).map(Number)); } catch (e) { window.favs = new Set(); }
  window.saveCart = () => localStorage.setItem('cart_v3', JSON.stringify(window.cart));
  window.updateCartBadge = () => {
    const n = window.cart.reduce((s, x) => s + x.qty, 0);
    const dot = $('topCartDot');
    dot.textContent = String(n);
    dot.style.display = n > 0 ? 'flex' : 'none';
    if (typeof syncCardCtls === 'function') syncCardCtls();
  };
  window.flyToCart = () => {
    const el = $('topCart');
    el.classList.remove('cart-bump'); void el.offsetWidth; el.classList.add('cart-bump');
  };
  /* Product detail, cart drawer and checkout all live on the main storefront.
     A tap here hands off to the existing product modal — no separate checkout is built here. */
  window.openProduct = id => { location.href = '/?p=' + id; };
  window.addToCart = (id, src) => {
    const p = state.byId[id];
    if (!p) return;
    /* products with colours or sizes are bought from the product page, where the choices are made */
    if (window.Pcx && Pcx.Variants && Pcx.Variants.needsChoice(p)) {
      toast('Choose your options');
      window.openProduct(id);
      return;
    }
    if (src) window.flyToCart(src);
    const ex = window.cart.find(x => x.id === id && !x.size && !x.color);
    if (ex) ex.qty += 1;
    else window.cart.push({ id: p.id, name: p.name, price: p.price, image_url: p.image_url, vendor_id: p.vendor_id || null, qty: 1, size: null, color: null });
    window.saveCart(); window.updateCartBadge();
    toast('Added to cart');
  };
  window.toggleFav = async id => {
    const on = !window.favs.has(id);
    if (on) window.favs.add(id); else window.favs.delete(id);
    localStorage.setItem('favs_v1', JSON.stringify([...window.favs]));
    document.querySelectorAll(`[data-fav="${id}"]`).forEach(b => b.classList.toggle('on', on));
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;
      if (on) await sb.from('favorites').upsert([{ user_id: session.user.id, product_id: id }], { onConflict: 'user_id,product_id' });
      else await sb.from('favorites').delete().eq('user_id', session.user.id).eq('product_id', id);
    } catch (e) { /* favorites table may not exist yet on this deployment — device-local still works */ }
  };

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1600);
  }

  /* ── PAGE STATE ────────────────────────────────────────────────── */
  const state = {
    vendor: null,
    storeName: 'Marcato',
    activeCategory: 'All',
    search: '',
    sort: 'featured',
    page: 0,
    total: 0,
    loaded: [],
    byId: {},
  };

  function slugFromPath() {
    const m = /\/store\/([^/?#]+)/.exec(location.pathname);
    return m ? decodeURIComponent(m[1]).trim() : '';
  }

  function showState(kind, { title, msg } = {}) {
    $('loader').classList.add('done');
    $('storeRoot').style.display = 'none';
    const screen = $('stateScreen');
    screen.classList.add('show');
    $('stateTitle').textContent = title || 'This store isn\u2019t available';
    $('stateMsg').textContent = msg || 'It may have moved, or the seller isn\u2019t accepting visitors right now.';
    screen.dataset.kind = kind;
  }

  /* ── DATA LOADING ──────────────────────────────────────────────── */

  /* Only public, non-KYC vendor columns are ever selected here — no bank,
     identity, address, phone or admin/rejection fields. */
  async function loadVendor(slug) {
    const { data, error } = await sb
      .from('vendors')
      .select('id,business_name,logo_url,store_slug,store_description,city,state,status,application_status,created_at')
      .eq('store_slug', slug)
      .eq('status', 'approved')
      .eq('application_status', 'approved')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function loadStoreSettings() {
    try {
      const { data } = await sb.from('store_settings').select('key,value').in('key', ['storeName', 'currency']);
      const get = k => data?.find(s => s.key === k)?.value;
      state.storeName = get('storeName') || 'Marcato';
      window.currency = get('currency') || '₦';
    } catch (e) { /* settings are optional; defaults above still work */ }
  }

  async function loadProductCount(vendorId) {
    const { count } = await sb.from('products').select('id', { count: 'exact', head: true }).eq('vendor_id', vendorId);
    return count || 0;
  }

  async function loadCategories(vendorId) {
    const { data } = await sb.from('products').select('category').eq('vendor_id', vendorId);
    const set = new Set();
    (data || []).forEach(r => { const c = (r.category || '').trim(); if (c) set.add(c); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  async function loadRatings(productIds) {
    if (!productIds.length) return;
    try {
      const { data } = await sb.from('product_ratings').select('*').in('product_id', productIds);
      (data || []).forEach(r => { window.ratingMap[r.product_id] = { avg: Number(r.avg_rating), n: Number(r.review_count) }; });
    } catch (e) { /* product_ratings view not present on this deployment — cards simply show no rating */ }
  }

  function storeRatingSummary() {
    const rows = Object.values(window.ratingMap);
    const n = rows.reduce((s, r) => s + (r.n || 0), 0);
    if (!n) return null;
    const avg = rows.reduce((s, r) => s + r.avg * r.n, 0) / n;
    return { avg, n };
  }

  async function fetchProductsPage(reset) {
    if (reset) { state.page = 0; state.loaded = []; }
    const from = state.page * PAGE_SIZE, to = from + PAGE_SIZE - 1;
    let q = sb.from('products')
      .select('id,name,price,original_price,category,stock,max_stock,description,image_url,featured,flash_sale,vendor_id,created_at', { count: 'exact' })
      .eq('vendor_id', state.vendor.id);

    if (state.activeCategory !== 'All') q = q.eq('category', state.activeCategory);
    if (state.search.trim()) q = q.ilike('name', `%${state.search.trim()}%`);

    if (state.sort === 'newest') q = q.order('created_at', { ascending: false });
    else if (state.sort === 'price_asc') q = q.order('price', { ascending: true });
    else if (state.sort === 'price_desc') q = q.order('price', { ascending: false });
    else q = q.order('featured', { ascending: false }).order('created_at', { ascending: false });

    q = q.range(from, to);
    const { data, count, error } = await q;
    if (error) throw error;
    state.total = count || 0;
    (data || []).forEach(p => { state.byId[p.id] = p; });
    state.loaded = reset ? (data || []) : state.loaded.concat(data || []);
    return data || [];
  }

  /* ── RENDERING ─────────────────────────────────────────────────── */

  function renderHero() {
    const v = state.vendor;
    $('topStoreName').textContent = v.business_name;
    document.title = `${v.business_name} · ${state.storeName}`;
    setMeta(v);

    renderLogo($('heroLogo'), v.logo_url, v.business_name);

    $('heroName').textContent = v.business_name;

    const loc = [v.city, v.state].filter(Boolean).join(', ');
    const metaParts = [];
    if (loc) metaParts.push(`<span>${LOC_SVG}${esc(loc)}</span>`);
    metaParts.push(`<span>${BOX_SVG}${state.total} product${state.total !== 1 ? 's' : ''}</span>`);
    $('heroMeta').innerHTML = metaParts.join('');

    if (v.store_description) {
      $('heroDesc').style.display = '';
      $('heroDesc').textContent = v.store_description;
    } else {
      $('heroDesc').style.display = 'none';
    }

    const rating = storeRatingSummary();
    if (rating) {
      $('heroRating').style.display = 'flex';
      $('heroRating').innerHTML = `${starsHTML(rating.avg, 14)}<span>${rating.avg.toFixed(1)} · ${esc(rating.n)} review${rating.n !== 1 ? 's' : ''} across their products</span>`;
    }
  }

  const LOC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  const BOX_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>';

  /* Built with DOM APIs rather than an HTML string, so there's no attribute-escaping
     surface at all for the fallback letter (a vendor-controlled business_name[0]). */
  function renderLogo(el, url, name) {
    const letter = (name && name[0] ? name[0] : '?').toUpperCase();
    el.textContent = '';
    if (!url) { el.textContent = letter; return; }
    const img = document.createElement('img');
    img.src = safeHref(url);
    img.alt = '';
    img.onerror = () => { el.textContent = letter; };
    el.appendChild(img);
  }

  function setMeta(v) {
    const desc = (v.store_description || `Shop ${v.business_name}'s products on ${state.storeName}.`).slice(0, 200);
    document.querySelector('meta[name="description"]').setAttribute('content', desc);
    const og = { 'og:title': `${v.business_name} · ${state.storeName}`, 'og:description': desc };
    Object.entries(og).forEach(([prop, content]) => {
      const el = document.querySelector(`meta[property="${prop}"]`);
      if (el) el.setAttribute('content', content);
    });
    if (v.logo_url) {
      let img = document.querySelector('meta[property="og:image"]');
      if (!img) { img = document.createElement('meta'); img.setAttribute('property', 'og:image'); document.head.appendChild(img); }
      img.setAttribute('content', v.logo_url);
    }
  }

  function renderCategoryPills(cats) {
    const wrap = $('catPills');
    if (!cats.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const all = ['All', ...cats];
    wrap.innerHTML = all.map(c =>
      `<button class="catPill${c === state.activeCategory ? ' on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`
    ).join('');
    wrap.querySelectorAll('.catPill').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeCategory = btn.dataset.c;
        wrap.querySelectorAll('.catPill').forEach(b => b.classList.toggle('on', b === btn));
        reloadGrid();
      });
    });
  }

  function renderGrid(products, append) {
    const grid = $('grid');
    if (!append) grid.innerHTML = '';
    if (!products.length && !append) {
      const emptyMsg = state.search.trim()
        ? `No products match "${esc(state.search.trim())}" in this store.`
        : (state.activeCategory !== 'All' ? `No products in ${esc(state.activeCategory)} yet.` : 'This seller hasn\u2019t listed any products yet.');
      grid.innerHTML = `<div class="empty"><h3>No products here</h3><p>${emptyMsg}</p></div>`;
      $('loadMoreWrap').style.display = 'none';
      return;
    }
    grid.insertAdjacentHTML('beforeend', products.map(p => `<div>${cardHTML(p)}</div>`).join(''));
    $('resultCount').textContent = `${state.total} item${state.total !== 1 ? 's' : ''}`;
    const shown = grid.children.length;
    $('loadMoreWrap').style.display = shown < state.total ? 'flex' : 'none';
  }

  async function reloadGrid() {
    $('grid').innerHTML = `<div class="empty"><h3>Loading\u2026</h3><p></p></div>`;
    try {
      const rows = await fetchProductsPage(true);
      await loadRatings(rows.map(p => p.id));
      renderGrid(rows, false);
    } catch (e) {
      console.error(e);
      $('grid').innerHTML = `<div class="empty"><h3>Couldn\u2019t load products</h3><p>Check your connection and try again.</p></div>`;
    }
  }

  async function loadMore() {
    const btn = $('loadMoreBtn');
    btn.disabled = true; btn.textContent = 'Loading\u2026';
    state.page += 1;
    try {
      const rows = await fetchProductsPage(false);
      await loadRatings(rows.map(p => p.id));
      renderGrid(rows, true);
    } finally {
      btn.disabled = false; btn.textContent = 'Load more';
    }
  }

  /* ── SEARCH (debounced) ────────────────────────────────────────── */
  let searchTimer;
  function onSearchInput(e) {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => { state.search = v; reloadGrid(); }, 300);
  }

  /* ── INIT ──────────────────────────────────────────────────────── */
  async function init() {
    window.updateCartBadge();
    const slug = slugFromPath();
    if (!slug) { showState('missing', { title: 'Store not found', msg: 'No store name was given in the link.' }); return; }

    try {
      await loadStoreSettings();
      const vendor = await loadVendor(slug);
      if (!vendor) {
        showState('unavailable', {
          title: 'This store isn\u2019t available',
          msg: 'The link may be wrong, or this seller isn\u2019t currently open to visitors.'
        });
        return;
      }
      state.vendor = vendor;

      const [count, cats] = await Promise.all([
        loadProductCount(vendor.id),
        loadCategories(vendor.id),
      ]);
      state.total = count;

      renderHero();
      renderCategoryPills(cats);

      const rows = await fetchProductsPage(true);
      await loadRatings(rows.map(p => p.id));
      renderHero(); // re-render meta line now that ratings may be in
      renderGrid(rows, false);

      $('searchInput').addEventListener('input', onSearchInput);
      $('sortSelect').addEventListener('change', e => { state.sort = e.target.value; reloadGrid(); });
      $('loadMoreBtn').addEventListener('click', loadMore);

      $('storeRoot').style.display = '';
      $('loader').classList.add('done');
    } catch (err) {
      console.error(err);
      showState('error', { title: 'Connection error', msg: 'Check your internet connection and reload the page.' });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
