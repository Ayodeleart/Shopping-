// Guards the Vercel Hobby limit: every non-underscore file under /api is one serverless function, max 12.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..', 'api');
function fns(dir, rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.name.startsWith('_') || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? fns(p, rel + e.name + '/') : (/\.(js|mjs|cjs|ts)$/.test(e.name) ? [rel + e.name] : []);
  });
}
test('api/ has at most 12 serverless functions', () => { const f = fns(API); assert.ok(f.length <= 12, f.length + ' functions: ' + f.join(', ')); });
test('every vercel.json /api rewrite points at a real route', () => {
  const v = require('../vercel.json');
  for (const r of v.rewrites.filter(r => r.source.startsWith('/api/'))) {
    const m = r.destination.match(/^\/api\/([\w-]+)\?fn=([\w-]+)$/); assert.ok(m, r.destination);
    const src = fs.readFileSync(path.join(API, m[1] + '.js'), 'utf8');
    assert.ok(src.includes(`'${m[2]}':`), r.destination);
    assert.ok(fs.existsSync(path.join(API, '_lib', 'routes', m[2] + '.js')), m[2]);
  }
  for (const k of Object.keys(v.functions || {})) assert.ok(fs.existsSync(path.join(__dirname, '..', k)), 'functions entry has no file: ' + k);
});
