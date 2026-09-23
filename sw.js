const CACHE = 'store-v14';
const SCOPE_HOME = '/';
const PRECACHE = ['/components/sw-register.js', '/data/safe.js', '/', '/index.html', '/manifest.json', '/icon.svg',
  '/components/promotional-carousel.css', '/components/promotional-carousel.js',
  '/components/promotion-slide.js', '/components/drag-gesture.js', '/data/promotions.js',
  '/components/ad-page.css', '/components/ad-page.js', '/data/ads.js', '/components/tile-row.css', '/components/tile-row.js',
  '/components/checkout-page.css', '/components/checkout-page.js', '/components/profile-page.css', '/components/profile-page.js', '/components/address-search.js', '/data/buyer.js',
  '/components/categories.css', '/components/category-page.js', '/data/categories.js',
  '/components/product-page.css', '/components/product-gallery.js', '/components/image-viewer.js',
  '/data/search.js', '/components/search-page.js', '/components/search-page.css',
  '/data/tracking.js', '/components/order-tracking.css', '/components/order-tracking.js',
  '/components/notification-center.css', '/components/notification-center.js',
  '/components/mac-fab.css', '/components/mac-fab.js', '/components/mac-chat.css', '/components/mac-chat.js', '/components/mac-theme.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  return self.clients.claim();
});

/* Freshness first. The old handler answered from the cache and only refreshed it in the background, so every
   release (and every Supabase data request, which it cached too) showed up on the SECOND open only. Now:
   - other origins (Supabase, logo.dev, fonts) and /api/ are never touched: they always go to the network
   - pages, scripts, styles: network first; the cache only answers when offline or when the network is slower than 4 s
   - images and icons: cache first (a changed image gets a new file name) */
const NET_TIMEOUT = 4000;

function fromCache(req) {
  return caches.match(req).then(c => c || (req.mode === 'navigate' ? caches.match(SCOPE_HOME) : undefined));
}

function networkFirst(req, cacheable) {
  return new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { fromCache(req).then(c => { if (c && !done) { done = true; resolve(c); } }); }, NET_TIMEOUT);
    fetch(req).then(res => {
      clearTimeout(timer);
      if (cacheable && res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      if (!done) { done = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fromCache(req).then(c => { if (!done) { done = true; resolve(c || Response.error()); } });
    });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.destination === 'image' || req.destination === 'font') {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(k => k.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(networkFirst(req, !url.search));     // pages with a ?query are not stored (shared links, tracking tags)
});

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  const title = data.title || 'Notification';
  const opts = {
    body: data.body || '',
    icon: 'app-icon-192.png',
    badge: 'app-icon-192.png',
    data: { url: data.url || '/', notificationId: data.notificationId || null },
    tag: data.tag || undefined,          /* the same notification arriving twice replaces itself instead of stacking */
    renotify: false
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    /* tell any open page so its unread badge updates immediately */
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => list.forEach(c => c.postMessage({ type: 'notification' })))
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        /* reuse the open app window and take it straight to the order */
        return c.focus().then(w => (w && 'navigate' in w ? w.navigate(target) : w));
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});
