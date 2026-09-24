/* The colour / size a customer picked must end up on the order line (order_items.variants), and saving it must never
   be able to fail a checkout. Unit-tests the helper in api/_lib/routes/checkout.js with a stubbed database. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function load(dbImpl) {
  const dbPath = require.resolve(path.join('..', 'api', '_lib', 'db'));
  const routePath = require.resolve(path.join('..', 'api', '_lib', 'routes', 'checkout'));
  delete require.cache[routePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { db: () => dbImpl, rpc: async () => ({}) } };
  return require(routePath);
}
/* tiny stand-in: select().eq().order() -> rows, update().eq() records the write */
function stubDb(rows, opts) {
  const writes = [];
  const from = table => {
    const q = { _u: null };
    q.select = () => q; q.eq = () => q; q.order = () => Promise.resolve(opts && opts.selectError ? { data: null, error: { message: 'x' } } : { data: rows, error: null });
    q.update = v => { q._u = v; return { eq: async (c, id) => { if (opts && opts.updateThrows) throw new Error('column "variants" does not exist'); writes.push({ table, id, set: v }); return { error: null }; } }; };
    return q;
  };
  return { from, writes };
}

test('variantsOf keeps only what was chosen and trims it', () => {
  const { variantsOf } = load(stubDb([]));
  assert.deepEqual(variantsOf({ color: ' Black ', size: 'XL' }), { Colour: 'Black', Size: 'XL' });
  assert.deepEqual(variantsOf({ color: 'Red', size: null }), { Colour: 'Red' });
  assert.equal(variantsOf({ color: null, size: '' }), null);
  assert.equal(variantsOf({}), null);
  assert.equal(variantsOf({ color: 'x'.repeat(200) }).Colour.length, 60);
});

test('saveVariants writes each line to its own order_items row (same product, different variants)', async () => {
  const db = stubDb([{ id: 501, product_id: 7, qty: 2 }, { id: 502, product_id: 7, qty: 1 }, { id: 503, product_id: 9, qty: 1 }]);
  const { saveVariants } = load(db);
  await saveVariants(88, [
    { product_id: 7, qty: 1, variants: { Colour: 'White', Size: 'M' } },
    { product_id: 7, qty: 2, variants: { Colour: 'Black', Size: 'XL' } },
    { product_id: 9, qty: 1, variants: null }
  ]);
  const by = Object.fromEntries(db.writes.map(w => [w.id, w.set.variants]));
  assert.deepEqual(by[502], { Colour: 'White', Size: 'M' });     // matched by quantity
  assert.deepEqual(by[501], { Colour: 'Black', Size: 'XL' });
  assert.equal(by[503], undefined, 'a product with no options is left alone');
});

test('saveVariants records an honest note when the database merged two variants into one row', async () => {
  const db = stubDb([{ id: 601, product_id: 7, qty: 3 }]);
  const { saveVariants } = load(db);
  await saveVariants(89, [
    { product_id: 7, qty: 2, variants: { Colour: 'Black', Size: 'XL' } },
    { product_id: 7, qty: 1, variants: { Colour: 'White', Size: 'M' } }
  ]);
  assert.equal(db.writes.length, 1);
  assert.match(db.writes[0].set.variants.Options, /Black \/ XL x2; White \/ M x1/);
});

test('saveVariants never throws: missing column or read error must not fail a checkout', async () => {
  const lines = [{ product_id: 7, qty: 1, variants: { Colour: 'Black' } }];
  await load(stubDb([{ id: 1, product_id: 7, qty: 1 }], { updateThrows: true })).saveVariants(1, lines);
  await load(stubDb([], { selectError: true })).saveVariants(1, lines);
  await load(stubDb([])).saveVariants(null, lines);
  await load(stubDb([])).saveVariants(1, []);
});
