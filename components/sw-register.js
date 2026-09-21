/* registerSW(url, options): registers a service worker and makes a new version take over without closing the app.
 *
 *   registerSW('/sw.js');   registerSW('sw.js', { scope: '/admin/' });
 *
 * - looks for a new version every time the app comes back to the screen (and every 30 minutes while it stays open)
 * - when a new version takes over, the page reloads once so the new code is what is running: right away if the app has just
 *   been opened, otherwise the next time it goes to the background (so a form being filled in is never wiped)
 */
(function (global) {
  'use strict';
  global.registerSW = function (url, options) {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    var hadController = !!navigator.serviceWorker.controller, reloading = false;

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading) return;               // first install: nothing old to replace
      var go = function () { reloading = true; location.reload(); };
      if (performance.now() < 20000 || document.hidden) { go(); return; }
      document.addEventListener('visibilitychange', function once() {
        if (document.hidden) { document.removeEventListener('visibilitychange', once); go(); }
      });
    });

    return navigator.serviceWorker.register(url, options).then(function (reg) {
      var check = function () { reg.update().catch(function () {}); };
      check();
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
      setInterval(check, 30 * 60 * 1000);
      return reg;
    }).catch(function () { return null; });
  };
})(window);
