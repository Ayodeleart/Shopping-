// Minimal in-memory stand-in for the supabase-js query builder (only what the AI code uses).
function splitTop(s) { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
function cond(row, c) {
  const m = /^([a-z_]+)\.(ilike|in|eq)\.(.*)$/.exec(c); if (!m) return true;
  const [, col, op, val] = m; const v = row[col];
  if (op === 'ilike') return String(v == null ? '' : v).toLowerCase().includes(val.replace(/%/g, '').toLowerCase());
  if (op === 'in') return val.replace(/[()]/g, '').split(',').map(Number).includes(Number(v));
  return String(v) === val;
}
function builder(db, table) {
  let rows = (db.tables[table] || []).slice(); const st = { inserted: null, single: false, maybe: false };
  const q = {
    select() { return q; },
    eq(c, v) { rows = rows.filter(r => r[c] === v); return q; },
    gte(c, v) { rows = rows.filter(r => r[c] >= v); return q; },
    lte(c, v) { rows = rows.filter(r => r[c] <= v); return q; },
    gt(c, v) { rows = rows.filter(r => r[c] > v); return q; },
    ilike(c, v) { rows = rows.filter(r => String(r[c] == null ? '' : r[c]).toLowerCase().includes(v.replace(/%/g, '').toLowerCase())); return q; },
    in(c, vs) { rows = rows.filter(r => vs.includes(r[c])); return q; },
    or(expr) { const cs = splitTop(expr); rows = rows.filter(r => cs.some(c => cond(r, c))); return q; },
    order() { return q; }, limit(n) { rows = rows.slice(0, n); return q; },
    maybeSingle() { st.maybe = true; return q; }, single() { st.single = true; return q; },
    insert(arr) { st.inserted = arr; return q; },
    then(res, rej) {
      let out;
      if (db.failTables && db.failTables[table]) out = { data: null, error: db.failTables[table] };
      else if (st.inserted) { db.tables[table] = (db.tables[table] || []).concat(st.inserted.map((r, i) => Object.assign({ id: (db.tables[table] || []).length + i + 1 }, r))); out = { data: { id: db.tables[table].length }, error: null }; }
      else if (st.single || st.maybe) out = { data: rows[0] || null, error: null };
      else out = { data: rows, error: null };
      return Promise.resolve(out).then(res, rej);
    }
  };
  return q;
}
function makeDb(tables, users) {
  const db = { tables, failTables: {}, from: t => builder(db, t), auth: { getUser: async tok => (users && users[tok] ? { data: { user: users[tok] }, error: null } : { data: null, error: { message: 'bad' } }) } };
  return db;
}
module.exports = { makeDb };
