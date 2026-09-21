const CACHE = 'store-v10';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icon.svg',
  '/components/promotional-carousel.css', '/components/promotional-carousel.js',
  '/components/promotion-slide.js', '/components/drag-gesture.js', '/data/promotions.js',
  '/components/ad-page.css', '/components/ad-page.js', '/data/ads.js', '/components/tile-row.css', '/components/tile-row.js',
  '/components/categories.css', '/components/category-page.js', '/data/categories.js',
  '/components/product-page.css', '/components/product-gallery.js', '/components/image-viewer.js',
  '/data/search.js', '/components/search-page.js', '/components/search-page.css',
  '/data/tracking.js', '/components/order-tracking.css', '/components/order-tracking.js',
  '/components/notification-center.css', '/components/notification-center.js',
  '/components/ai-assistant.css', '/components/ai-assistant.js'];

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

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
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
