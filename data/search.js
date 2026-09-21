/* Pcx.Search: the search engine behind the storefront search page (no network, runs on the products already loaded).
 *
 *   const index = Pcx.Search.buildIndex(products, p => ({ brand: 'Samsung', cats: ['Phones', 'Android'], vendor: 'Joseph' }));
 *   const res = Pcx.Search.search(index, 'samsng galaxy');   // { items: [{ p, score, fuzzy }], partial, fuzzy, tokens }
 *   Pcx.Search.rankNames(brands, 'sams', b => b.name);       // brands / categories whose name fits the query
 *   Pcx.Search.highlight('Samsung Galaxy', 'sams');            // escaped HTML with <mark> around the matched parts
 *   Pcx.Search.recent.get() / add('tv') / remove('tv') / clear()   // recent searches, kept on this device
 *
 * How a product is scored (every word of the query has to match something, so "red nike shoes" narrows down):
 *   product name > brand > category (and its parents) > seller name > description.
 *   Word start beats a match in the middle of a word; plurals are ignored (shoe = shoes); and a word of 4+ letters
 *   that matches nothing exactly still finds close spellings ("samsng" finds Samsung, "adidass" finds Adidas).
 *   When no product contains every word, the products that contain some of them are returned as `partial`.
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  /* ---------------------------------------------------------------- text */
  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* light plural handling, applied to both the query and the product text so they meet in the middle */
  function stem(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function words(s) {
    var out = [];
    norm(s).split(' ').forEach(function (w) { if (w) out.push(stem(w)); });
    return out;
  }

  function tokens(q) {
    var seen = {}, out = [];
    words(q).forEach(function (w) {
      if (w.length < 2 && !/^[0-9]$/.test(w)) return;
      if (!seen[w]) { seen[w] = 1; out.push(w); }
    });
    return out;
  }

  /* edit distance, giving up as soon as it is certain to be above `max` */
  function lev(a, b, max) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur[0] = i;
      var rowMin = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      var t = prev; prev = cur; cur = t;
    }
    return prev[lb];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------------- index */
  function buildIndex(products, ctx) {
    return (products || []).map(function (p, i) {
      var c = (ctx ? ctx(p) : null) || {};
      var brand = c.brand || p.brand || '';
      var cats = c.cats && c.cats.length ? c.cats : (p.category ? [p.category] : []);
      return {
        p: p, order: i,
        name: norm(p.name), nameWords: words(p.name),
        brand: norm(brand), brandWords: words(brand),
        cat: norm(cats.join(' ')), catWords: words(cats.join(' ')),
        vendor: norm(c.vendor || ''),
        desc: ' ' + norm(p.description).slice(0, 600)
      };
    });
  }

  /* best score of one query word against one product, plus whether it was only a spelling match */
  function scoreToken(t, e) {
    var best = 0, i, w;
    for (i = 0; i < e.nameWords.length; i++) {
      w = e.nameWords[i];
      if (w === t) { best = 10; break; }
      if (t.length >= 2 && w.indexOf(t) === 0) best = Math.max(best, 8);
      else if (t.length >= 3 && w.indexOf(t) > 0) best = Math.max(best, 5);
    }
    if (best < 10) {
      for (i = 0; i < e.brandWords.length; i++) {
        w = e.brandWords[i];
        if (w === t) best = Math.max(best, 9);
        else if (t.length >= 2 && w.indexOf(t) === 0) best = Math.max(best, 7);
        else if (t.length >= 3 && w.indexOf(t) > 0) best = Math.max(best, 4);
      }
      for (i = 0; i < e.catWords.length; i++) {
        w = e.catWords[i];
        if (w === t) best = Math.max(best, 6);
        else if (t.length >= 2 && w.indexOf(t) === 0) best = Math.max(best, 5);
        else if (t.length >= 3 && w.indexOf(t) > 0) best = Math.max(best, 3);
      }
      if (e.vendor) {
        if ((' ' + e.vendor).indexOf(' ' + t) >= 0) best = Math.max(best, 3);
        else if (t.length >= 3 && e.vendor.indexOf(t) >= 0) best = Math.max(best, 2);
      }
      if (e.desc.indexOf(' ' + t) >= 0) best = Math.max(best, 1.5);
      else if (t.length >= 3 && e.desc.indexOf(t) >= 0) best = Math.max(best, 1);
    }
    if (best > 0) return { s: best, fuzzy: false };

    if (t.length >= 4) {                                   // nothing matched: try close spellings
      var maxD = t.length >= 7 ? 2 : 1, hit = 0, pool = e.nameWords.concat(e.brandWords, e.catWords);
      for (i = 0; i < pool.length; i++) {
        w = pool[i];
        if (w.length < 4) continue;
        var d = lev(w, t, maxD);
        if (d <= maxD) hit = Math.max(hit, 3.5 - d * 0.5);
      }
      if (hit) return { s: hit, fuzzy: true };
    }
    return { s: 0, fuzzy: false };
  }

  function search(index, q) {
    var toks = tokens(q), full = norm(q);
    var out = { items: [], partial: false, fuzzy: false, tokens: toks };
    if (!toks.length) return out;

    var full_ = [], part = [];
    index.forEach(function (e) {
      var sum = 0, matched = 0, fuzzy = false, inName = 0;
      toks.forEach(function (t) {
        var r = scoreToken(t, e);
        if (r.s > 0) {
          matched++; sum += r.s; if (r.fuzzy) fuzzy = true;
          if (e.nameWords.some(function (w) { return w.indexOf(t) === 0 || w === t; })) inName++;
        }
      });
      if (!matched) return;
      if (matched === toks.length) {
        if (full && e.name.indexOf(full) === 0) sum += 8;
        else if (full && e.name.indexOf(full) >= 0) sum += 5;
        if (toks.length > 1 && inName === toks.length) sum += 4;
        full_.push({ p: e.p, score: sum, fuzzy: fuzzy, order: e.order });
      } else {
        part.push({ p: e.p, score: sum + matched * 3, matched: matched, order: e.order });
      }
    });

    var byScore = function (a, b) { return (b.score - a.score) || (a.order - b.order); };
    if (full_.length) {
      full_.sort(byScore);
      out.items = full_;
      out.fuzzy = !!full_[0].fuzzy;
    } else if (part.length) {
      part.sort(function (a, b) { return (b.matched - a.matched) || byScore(a, b); });
      out.items = part;
      out.partial = true;
    }
    return out;
  }

  /* brands / categories whose name fits the query, best first (used for the chips in suggestions) */
  function rankNames(list, q, getName) {
    var toks = tokens(q);
    if (!toks.length) return [];
    var scored = [];
    (list || []).forEach(function (item) {
      var w = words(getName(item)), n = norm(getName(item)), total = 0, ok = true;
      toks.forEach(function (t) {
        var s = 0;
        w.forEach(function (x) {
          if (x === t) s = Math.max(s, 3);
          else if (x.indexOf(t) === 0) s = Math.max(s, 2);
          else if (t.length >= 3 && x.indexOf(t) > 0) s = Math.max(s, 1);
          else if (t.length >= 4 && x.length >= 4 && lev(x, t, t.length >= 7 ? 2 : 1) <= (t.length >= 7 ? 2 : 1)) s = Math.max(s, 0.5);
        });
        if (!s) ok = false; total += s;
      });
      if (ok) scored.push({ item: item, score: total + (n === norm(q) ? 3 : 0) });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.map(function (x) { return x.item; });
  }

  /* escaped HTML with the words the person typed marked */
  function highlight(text, q) {
    var src = String(text == null ? '' : text);
    var toks = String(q || '').toLowerCase().split(/[^a-z0-9]+/i).filter(function (t) { return t.length >= 2; });
    if (!toks.length) return esc(src);
    toks.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp('(' + toks.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')', 'ig');
    return src.split(re).map(function (part, i) { return i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part); }).join('');
  }

  /* ---------------------------------------------------------------- recent searches */
  var KEY = 'recent_searches_v1', MAX = 10;
  var recent = {
    get: function () {
      try { var a = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x; }).slice(0, MAX) : []; }
      catch (e) { return []; }
    },
    add: function (q) {
      q = String(q || '').trim().replace(/\s+/g, ' ');
      if (q.length < 2) return;
      var list = recent.get().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
      list.unshift(q);
      try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* private mode */ }
    },
    remove: function (q) {
      var list = recent.get().filter(function (x) { return x !== q; });
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    },
    clear: function () { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
  };

  Pcx.Search = {
    norm: norm, tokens: tokens, stem: stem, lev: lev, esc: esc,
    buildIndex: buildIndex, search: search, rankNames: rankNames, highlight: highlight, recent: recent
  };
})(window);
