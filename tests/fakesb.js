// In-memory stand-in for the supabase-js query builder, enough for the Explore worlds code
// (select / insert / update / delete, eq / in / order / single / maybeSingle, storage, auth session).
// It also mimics three database rules the code depends on: unique world slugs, ON DELETE CASCADE from a world to its
// heroes and display categories (and from a display category to its links), and admin-only writes with
// is_active-only reads for everyone else (the row level security in migration_explore_worlds.sql).
function makeSb(seed, opts) {
  opts = opts || {};
  const db = {
    tables: JSON.parse(JSON.stringify(seed || {})),
    isAdmin: opts.isAdmin !== false,
    missingColumns: opts.missingColumns || {},      // { worlds: ['is_active'] } -> selects naming them fail like Postgres would
    missingTables: opts.missingTables || [],
    nextId: {},
    calls: [],
    storage: { files: {}, removed: [] }
  };
  const PUBLIC_READ_ACTIVE = { worlds: 1, world_heroes: 1, world_display_categories: 1 };
  const CASCADE = { worlds: [['world_heroes', 'world_slug', 'slug'], ['world_display_categories', 'world_slug', 'slug']], world_display_categories: [['world_category_links', 'display_category_id', 'id']] };

  function rows(t) { return db.tables[t] || (db.tables[t] = []); }
  function idFor(t) { db.nextId[t] = (db.nextId[t] || Math.max(0, ...rows(t).map(r => r.id || 0))) + 1; return db.nextId[t]; }

  function cascade(t, removed) {
    (CASCADE[t] || []).forEach(([child, fk, pk]) => {
      removed.forEach(r => {
        const gone = rows(child).filter(c => c[fk] === r[pk]);
        db.tables[child] = rows(child).filter(c => c[fk] !== r[pk]);
        cascade(child, gone);
      });
    });
  }

  function builder(t) {
    const st = { op: 'select', cols: '*', filters: [], order: [], payload: null, single: false, maybe: false, returning: false };
    const q = {
      select(c) { if (st.op === 'select') st.cols = c || '*'; else st.returning = true; return q; },
      insert(p) { st.op = 'insert'; st.payload = p; return q; },
      update(p) { st.op = 'update'; st.payload = p; return q; },
      delete() { st.op = 'delete'; return q; },
      eq(c, v) { st.filters.push(r => r[c] === v); st.filterCols = (st.filterCols || []).concat(c); return q; },
      in(c, vs) { st.filters.push(r => vs.some(v => String(v) === String(r[c]))); return q; },
      range(a, b) { st.range = [a, b]; return q; },
      order(c, o) { st.order.push([c, !(o && o.ascending === false)]); return q; },
      single() { st.single = true; return q; },
      maybeSingle() { st.maybe = true; return q; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      db.calls.push({ t, op: st.op });
      if (db.missingTables.includes(t)) return { data: null, error: { message: `Could not find the table 'public.${t}' in the schema cache` } };
      const missing = db.missingColumns[t] || [];
      const named = String(st.cols).split(',').map(s => s.trim()).concat(st.filterCols || []);
      if (st.op === 'select' && missing.some(c => named.includes(c))) return { data: null, error: { message: `column ${t}.${missing.find(c => named.includes(c))} does not exist` } };

      let list = rows(t).filter(r => st.filters.every(f => f(r)));
      if (st.op === 'select') {
        if (!db.isAdmin && PUBLIC_READ_ACTIVE[t]) list = list.filter(r => r.is_active !== false);
        if (st.order.length) list.sort((a, b) => { for (const [c, asc] of st.order) { const d = (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1); if (d) return d; } return 0; });   // first .order() is the primary key, like PostgREST
        if (st.range) list = list.slice(st.range[0], st.range[1] + 1);
        list = list.map(r => Object.assign({}, r));
        return finish(list);
      }
      if (!db.isAdmin) return { data: null, error: { message: 'new row violates row-level security policy for table "' + t + '"' } };
      if (st.op === 'insert') {
        const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
        const out = [];
        for (const p of arr) {
          const row = Object.assign({}, p);
          if (t === 'worlds') {
            if (rows(t).some(r => r.slug === row.slug)) return { data: null, error: { message: 'duplicate key value violates unique constraint "worlds_slug_key"' } };
            if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug || '')) return { data: null, error: { message: 'new row for relation "worlds" violates check constraint "worlds_slug_format"' } };
            if (row.is_active === undefined) row.is_active = true;
          } else if (t !== 'world_category_links') {
            row.id = idFor(t);
            if (row.is_active === undefined) row.is_active = true;
            if (t === 'world_display_categories' && !String(row.name || '').trim()) return { data: null, error: { message: 'violates check constraint' } };
            if (!rows('worlds').some(w => w.slug === row.world_slug)) return { data: null, error: { message: 'violates foreign key constraint (world_slug)' } };
          } else if (rows(t).some(r => r.display_category_id === row.display_category_id && String(r.category_id) === String(row.category_id))) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
          }
          rows(t).push(row); out.push(Object.assign({}, row));
        }
        return finish(st.returning ? out : []);
      }
      if (st.op === 'update') {
        const out = [];
        list.forEach(r => {
          const oldSlug = r.slug;
          if (t === 'worlds' && st.payload.slug && st.payload.slug !== oldSlug && rows(t).some(x => x !== r && x.slug === st.payload.slug)) { out.dup = true; return; }
          Object.assign(r, st.payload); out.push(Object.assign({}, r));
          if (t === 'worlds' && st.payload.slug && st.payload.slug !== oldSlug) {          // ON UPDATE CASCADE
            ['world_heroes', 'world_display_categories'].forEach(c => rows(c).forEach(x => { if (x.world_slug === oldSlug) x.world_slug = r.slug; }));
          }
        });
        if (out.dup) return { data: null, error: { message: 'duplicate key value violates unique constraint "worlds_slug_key"' } };
        return finish(st.returning ? out : []);
      }
      if (st.op === 'delete') {
        const gone = list.slice();
        db.tables[t] = rows(t).filter(r => !gone.includes(r));
        cascade(t, gone);
        return { data: null, error: null };
      }
    }
    function finish(list) {
      if (st.single) return list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      if (st.maybe) return { data: list[0] || null, error: null };
      return { data: list, error: null };
    }
    return q;
  }

  db.from = builder;
  db.storage.from = () => ({
    upload: async (path, file) => { db.storage.files[path] = file; return { data: { path }, error: null }; },
    remove: async paths => { db.storage.removed.push(...paths); paths.forEach(p => delete db.storage.files[p]); return { data: [], error: null }; },
    getPublicUrl: path => ({ data: { publicUrl: 'https://cdn.test/storage/v1/object/public/avatars/' + path } })
  });
  // db.storage is used as sb.storage
  db.auth = { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) };
  db.storageApi = db.storage;
  const sb = { from: db.from, storage: { from: db.storage.from }, auth: db.auth, _db: db };
  return sb;
}
module.exports = { makeSb };
