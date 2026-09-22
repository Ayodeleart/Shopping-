const CACHE = 'vendor-v8';
const SCOPE_HOME = '/vendor/';
const PRECACHE = ['/components/sw-register.js', '/vendor/', '/vendor/index.html', '/vendor/manifest.json', '/icon.svg', '/components/multi-image-picker.js', '/components/multi-image-picker.css',
  '/components/product-attributes.js', '/components/product-attributes.css', '/components/categories.css', '/components/category-picker.js', '/data/categories.js',
  '/components/brand-picker.js', '/components/brand-picker.css'];

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
    data: { url: data.url || '/vendor/' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/vendor/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.includes(url) && 'focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
