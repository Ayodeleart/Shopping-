/* Pcx.Safe: the one set of encoders every page uses when it puts database or user-controlled text into HTML.
 *
 *   esc(v)      text or a quoted attribute value: & < > " ' ` are turned into entities, so a name like <img onerror=...> is shown as text
 *   safeUrl(v)  a URL for href / src / action: only http, https, mailto, tel, blob, relative paths and image data URLs are kept
 *               (javascript:, vbscript:, data:text/html ... become an empty string); the result is already escaped
 *   safeHref(v) the same URL rule for a DOM property: img.src = safeHref(url), a.href = safeHref(url) (validated, not escaped)
 *   hs(v)       a value inside a quoted JS string inside an inline event handler: onclick="go('${hs(x)}')"
 *   num(v)      a number inside an inline event handler or style: onclick="open(${num(id)})"; anything that is not a number becomes 0
 *   cssColor(v) a colour for a style attribute (hex, rgb/hsl, a colour name or var(--x)); anything else becomes an empty string
 *
 * Rules the code follows (checked by a script over the whole repo): never put a raw database value into an HTML string;
 * wrap it in the encoder that matches where it lands. Plain text that needs no markup should use textContent instead.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};
  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (c) { return MAP[c]; }); }

  function safeUrl(v) {
    var s = String(v == null ? '' : v).trim();
    var probe = s.replace(/[\u0000-\u0020\u007f-\u009f\u2028\u2029]+/g, '');      // browsers ignore tabs / newlines inside a scheme
    if (!probe) return '';
    var m = /^([a-z][a-z0-9+.\-]*):/i.exec(probe);
    if (m) {
      var sc = m[1].toLowerCase();
      var ok = sc === 'http' || sc === 'https' || sc === 'blob' || sc === 'mailto' || sc === 'tel' ||
               (sc === 'data' && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(probe));
      if (!ok) return '';
    }
    return esc(s);
  }

  /* the same rule for a value assigned to a DOM property (img.src = ..., a.href = ...): validated but NOT html-escaped */
  function safeHref(v) {
    var s = String(v == null ? '' : v).trim();
    var probe = s.replace(/[\u0000-\u0020\u007f-\u009f\u2028\u2029]+/g, '');
    if (!probe) return '';
    var m = /^([a-z][a-z0-9+.\-]*):/i.exec(probe);
    if (m) {
      var sc = m[1].toLowerCase();
      var ok = sc === 'http' || sc === 'https' || sc === 'blob' || sc === 'mailto' || sc === 'tel' ||
               (sc === 'data' && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(probe));
      if (!ok) return '';
    }
    return s;
  }

  function hs(v) {
    return String(v == null ? '' : v).replace(/[\\'"<>&`\u0000-\u001f\u2028\u2029]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function num(v) { var n = Number(v); return isFinite(n) ? String(n) : '0'; }

  function cssColor(v) {
    var s = String(v == null ? '' : v).trim();
    return /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(rgb|hsl)a?\(\s*[0-9., %\/-]+\)|var\(--[a-z0-9-]+\))$/i.test(s) ? s : '';
  }

  var api = { esc: esc, safeUrl: safeUrl, safeHref: safeHref, hs: hs, num: num, cssColor: cssColor };
  Pcx.Safe = api;
  Object.keys(api).forEach(function (k) { if (!global[k]) global[k] = api[k]; });   // available as plain esc(), safeUrl() ... on every page
})(window);
