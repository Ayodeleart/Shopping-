/* Pcx.macTheme: MAC's accent colour, chosen from the chat's Settings screen and remembered per device.
 *
 * Every other MAC surface (mac-fab.css, mac-chat.css) reads a single custom property, --mac-accent-user, with no
 * fallback of its own baked in — when nothing has been chosen it stays unset and both files fall back to the
 * store's own --red, so nothing changes until a shopper actually picks a colour.
 *
 * The Pride preset can't be expressed as a single colour (SVG fill and CSS background both need a real gradient
 * value), so this module also injects one tiny, invisible <svg><defs> once, for mac-fab's circular "ball" to
 * reference by url(#mac-pride-grad); the flat CSS elements in mac-chat.css use a plain linear-gradient() instead.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};
  var KEY = 'mac_accent_pref';

  var PRESETS = [
    { id: 'default', hex: null },
    { id: 'yellow', hex: '#F5B301' },
    { id: 'green', hex: '#1DA34C' },
    { id: 'blue', hex: '#2563EB' },
    { id: 'purple', hex: '#8B5CF6' },
    { id: 'pink', hex: '#EC4899' },
    { id: 'pride', hex: null, pride: true }
  ];
  var PRIDE_STOPS = ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787'];

  function find(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return PRESETS[0]; }

  function ensureGradientDef() {
    if (document.getElementById('mac-pride-grad')) return;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    var stops = PRIDE_STOPS.map(function (c, i) { return '<stop offset="' + Math.round(i * 100 / (PRIDE_STOPS.length - 1)) + '%" stop-color="' + c + '"/>'; }).join('');
    svg.innerHTML = '<defs><linearGradient id="mac-pride-grad" x1="0" y1="0" x2="1" y2="1">' + stops + '</linearGradient></defs>';
    (document.body || document.documentElement).appendChild(svg);
  }

  function apply(id) {
    var p = find(id), root = document.documentElement;
    root.classList.toggle('mac-pride', !!p.pride);
    if (p.pride) { ensureGradientDef(); root.style.removeProperty('--mac-accent-user'); }
    else if (p.hex) root.style.setProperty('--mac-accent-user', p.hex);
    else root.style.removeProperty('--mac-accent-user');
  }

  function get() { try { return localStorage.getItem(KEY) || 'default'; } catch (e) { return 'default'; } }
  function set(id) {
    if (!find(id) || id !== find(id).id) id = 'default';
    try { localStorage.setItem(KEY, id); } catch (e) { /* private mode / full */ }
    apply(id);
  }

  Pcx.macTheme = { PRESETS: PRESETS, get: get, set: set, apply: apply };
  apply(get());   // as early as possible, so MAC never flashes the wrong colour on load
})(window);
