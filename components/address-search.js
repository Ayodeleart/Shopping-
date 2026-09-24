/* Pcx.AddressSearch
 * A search box for Nigerian addresses, backed by /api/geocode (Nominatim, OpenStreetMap's open geocoder).
 * The public Nominatim server forbids search-as-you-type, so the search runs only when the customer taps Search or
 * presses Enter, and "Use my location" runs once per tap.
 *
 *   const s = Pcx.AddressSearch.mount(el, { onPick(addr) {} });   // addr: { line1, area, city, state, lat, lon, display_name }
 *   s.focus();
 */
(function (global) {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function mount(root, opts) {
    root.classList.add('asrch');
    root.innerHTML =
      '<div class="asrch__row">' +
        '<input class="asrch__q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Search your street, area or landmark">' +
        '<button type="button" class="asrch__go">Search</button>' +
      '</div>' +
      '<button type="button" class="asrch__loc"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>Use my current location</button>' +
      '<div class="asrch__msg" aria-live="polite"></div><div class="asrch__list"></div>';
    var q = root.querySelector('.asrch__q'), msg = root.querySelector('.asrch__msg'), list = root.querySelector('.asrch__list');
    var busy = false, last = [];

    function say(t, err) { msg.textContent = t || ''; msg.classList.toggle('is-err', !!err); }

    function show(results) {
      last = results;
      list.innerHTML = results.map(function (r, i) {
        return '<button type="button" class="asrch__item" data-i="' + i + '"><b>' + esc(r.line1) + '</b><span>' + esc([r.area, r.city, r.state].filter(Boolean).join(', ')) + '</span></button>';
      }).join('');
      say(results.length ? 'Tap the right address' : 'No match. Try a nearby landmark or type the address yourself below.');
    }

    async function call(qs) {
      if (busy) return;
      busy = true; say('Searching...'); list.innerHTML = '';
      try {
        var r = await fetch('/api/geocode?' + qs);
        var j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Search failed');
        show(j.results || []);
      } catch (e) { say(e.message || 'Address search is unavailable. Type the address below.', true); }
      busy = false;
    }

    function search() {
      var v = q.value.trim();
      if (v.length < 3) { say('Type at least 3 characters.', true); return; }
      call('q=' + encodeURIComponent(v));
    }

    root.querySelector('.asrch__go').addEventListener('click', search);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    root.querySelector('.asrch__loc').addEventListener('click', function () {
      if (!navigator.geolocation) { say('Location is not available on this device.', true); return; }
      say('Finding you...');
      navigator.geolocation.getCurrentPosition(
        function (p) { call('lat=' + p.coords.latitude + '&lon=' + p.coords.longitude); },
        function () { say('We could not get your location. Search for your address instead.', true); },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
    list.addEventListener('click', function (e) {
      var b = e.target.closest('.asrch__item');
      if (!b) return;
      var r = last[+b.dataset.i];
      list.innerHTML = ''; say('');
      if (opts && opts.onPick) opts.onPick(r);
    });
    return { focus: function () { q.focus(); }, reset: function () { q.value = ''; list.innerHTML = ''; say(''); } };
  }

  (global.Pcx = global.Pcx || {}).AddressSearch = { mount: mount };
})(window);
