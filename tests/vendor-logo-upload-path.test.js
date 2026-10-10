/* The avatars bucket's write policy only allows <category>/<own uid>/<file> (migration_avatars_storage_rls.sql).
   Regression: the onboarding logo used 'store-logos' with no uid folder, so every upload was blocked by RLS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'index.html'), 'utf8');

test('every vendor logo upload goes into <category>/<uid>/ so the storage policy accepts it', () => {
  const calls = [...src.matchAll(/uploadImage\(file,\s*([^,]+),/g)].map(m => m[1].trim());
  const logoCalls = calls.filter(c => /logo/i.test(c));
  assert.ok(logoCalls.length >= 2, 'expected the onboarding and settings logo uploads');
  for (const c of logoCalls) assert.match(c, /session\.user\.id/, 'logo folder missing the uid: ' + c);
});
