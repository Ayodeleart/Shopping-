/* Marcato Vendor Center — seller landing page, dedicated vendor login/registration,
 * vendor profile protection and the manual-KYC review workflow.
 *
 * Two kinds of checks:
 *   1. Static wiring: the landing page, links, migration SQL and admin/vendor markup
 *      contain what the flows depend on.
 *   2. Behavioural (jsdom, real vendor/index.html + a Supabase stub): arriving from
 *      "Sell on Marcato" (?intent=register) shows the registration view, arriving to
 *      sign in shows the login view, and a signed-out visitor never sees the dashboard.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ── 1. SELLER LANDING PAGE ─────────────────────────────────────────── */

test('Seller Center landing is a compact entry screen (no marketing sections) with working CTAs', () => {
  const html = read('sell/index.html');
  assert.match(html, /Seller Center/i, 'has Marcato Seller Center identity');
  assert.match(html, /id="signInBtn" href="\/vendor\/\?intent=signin"/, '"Sign in with Email" opens the dedicated vendor login');
  assert.match(html, /id="sellBtn" href="\/sell\/register\/"/, '"Sell on Marcato" opens the registration-start screen');
  assert.doesNotMatch(html, /<h[12][^>]*>[^<]{60,}/, 'no long marketing headline');
  assert.doesNotMatch(html, /class="(cards?|steps?|hero|ctaBand|needList)"/, 'no feature cards / hero / how-it-works sections');
  assert.ok(html.length < 5000, 'landing stays small');
});

test('registration-start screen: Local continues to existing vendor registration; International is not enabled', () => {
  const html = read('sell/register/index.html');
  assert.match(html, /Sell on Marcato/);
  assert.match(html, /business based in Nigeria/);
  assert.match(html, /id="locIntl" disabled/, 'international registration is not offered (Nigeria-only rules)');
  assert.match(html, /\/vendor\/\?intent=register/, 'Next continues into the existing vendor registration');
  assert.match(html, /href="\/vendor\/\?intent=signin"/, '"Already have an account? Sign in" opens vendor login');
  assert.match(html, /href="\/sell\/" id="backBtn"/, 'back returns to the Seller Center');
});

test('main site "Sell on Marcato" entry points open the seller landing page, not the login', () => {
  const html = read('index.html');
  const sellLinks = html.match(/href="\/sell\/"/g) || [];
  assert.ok(sellLinks.length >= 3, `footer, menu and account entries link to /sell/ (found ${sellLinks.length})`);
  assert.ok(!/href="\/vendor\/"[^>]*>[^<]*Sell on Marcato/.test(html), 'no "Sell on Marcato" link goes straight to /vendor/ any more');
});

/* ── 2. DEDICATED VENDOR LOGIN + REGISTRATION (same Supabase Auth backend) ── */

test('vendor login page: Vendor Center branding, register view, and a way back to the landing page', () => {
  const html = read('vendor/index.html');
  assert.match(html, /<title>Marcato Seller Center<\/title>/);
  assert.match(html, /class="vcBack" href="\/sell\/"/, 'link back to the seller landing page');
  assert.match(html, /location\.href = '\/sell\/register\/'/, '"Sell on Marcato" on the login goes to the registration-start screen');
  for (const id of ['authFormView', 'authRegView', 'authResetView', 'authForgot', 'authSubmit',
    'regEmail', 'regPass', 'regPass2', 'regSubmit', 'authGoRegister', 'authGoSignIn2']) {
    assert.ok(html.includes(`id="${id}"`), `element #${id} present`);
  }
  assert.match(html, /data-for="regPass"/, 'password visibility toggle on registration');
  assert.match(html, /marcato_vendor_intent/, 'landing-page intent survives the OAuth round-trip');
  assert.match(html, /sb\.auth\.signUp\(/, 'registration uses the existing Supabase Auth (no second auth system)');
  assert.ok(!/Maccato/.test(html), 'brand typo fixed');
});

test('customer login stays separate: no vendor registration form or seller messaging in index.html auth', () => {
  const html = read('index.html');
  assert.ok(!/Maccato/.test(html), 'brand typo fixed on the customer site');
  assert.ok(html.includes('id="authSignUpView"'), 'customer sign-up view retained');
  assert.ok(html.includes("signInWithOAuth"), 'Google sign-in retained');
  assert.ok(html.includes("resetPasswordForEmail"), 'password recovery retained');
  assert.ok(!html.includes('authRegView'), 'vendor-center registration view is not part of the customer login');
  assert.ok(!/seller application/i.test(html.slice(html.indexOf('id="acctSignedOut"'), html.indexOf('id="acctSignedIn"'))),
    'no seller-application messaging inside the customer auth drawer');
});

/* ── 3. PROFILE: SAVED APPLICATION DATA + PROTECTED FIELDS ──────────── */

test('vendor profile shows the saved application read-only and files corrections via vendor_events', () => {
  const html = read('vendor/index.html');
  for (const id of ['roLegalName', 'roDob', 'roGender', 'roIdDoc', 'roBank', 'roTerms', 'roSubmitted',
    'sAppStatusBadge', 'sNextSteps', 'reqCorrectionBtn']) {
    assert.ok(html.includes(`id="${id}"`), `profile element #${id} present`);
  }
  // read-only application fields are disabled inputs, never sent in the save patch
  assert.match(html, /id="roLegalName" disabled/);
  const save = html.slice(html.indexOf("document.getElementById('sSaveBtn').onclick"), html.indexOf('PUSH NOTIFICATIONS'));
  for (const banned of ['status', 'application_status', 'id_verification', 'bank_', 'approved_at', 'first_name', 'date_of_birth']) {
    assert.ok(!save.includes(`patch.${banned}`) && !new RegExp(`patch = \\{[^}]*${banned}`).test(save),
      `storefront save never writes protected field "${banned}"`);
  }
  assert.match(html, /from\('vendor_events'\)\.insert/, 'correction request goes through the controlled vendor_events channel');
  assert.match(html, /type: 'correction_request'/);
});

/* ── 4. MIGRATION: RLS + trigger protection, safe public view, audit trail ── */

test('migration_vendor_center.sql: idempotent and enforces protection server-side', () => {
  const sql = read('migration_vendor_center.sql');
  // safe public view replaces the all-columns public read policy
  assert.match(sql, /create or replace view public\.vendors_public/);
  assert.ok(!/bank_account_number|id_verification_number|date_of_birth|first_name/.test(sql.slice(sql.indexOf('vendors_public as'), sql.indexOf('grant select on public.vendors_public'))),
    'public view exposes no KYC/bank/identity columns');
  assert.match(sql, /drop policy if exists "vendors_public_read_approved" on vendors/);
  // field guard trigger
  assert.match(sql, /create or replace function public\.vendors_guard/);
  assert.match(sql, /drop trigger if exists vendors_guard_trg on vendors/);
  for (const col of ['status', 'approved_at', 'id_verification_status', 'bank_account_number', 'bank_verification_status', 'rejection_reason']) {
    assert.ok(sql.includes(`old.${col}`), `trigger protects ${col}`);
  }
  assert.match(sql, /new\.status := 'pending'/, 'crafted inserts cannot self-approve');
  assert.match(sql, /email_confirmed_at is not null/, '"verified" stamps must match Supabase Auth');
  // approved vendors can save their storefront again (old policy blocked them)
  assert.match(sql, /drop policy if exists "vendors_self_update" on vendors/);
  // products: approved vendors only
  assert.match(sql, /drop policy if exists "products_vendor_write" on products/);
  assert.match(sql, /vendors_public vp where vp\.id = auth\.uid\(\)/);
  // audit trail with vendor-limited insert
  assert.match(sql, /create table if not exists vendor_events/);
  assert.match(sql, /type = 'correction_request'/, 'vendors may only insert correction requests');
  // idempotency: every create has an if-not-exists / or-replace / drop-first guard
  assert.ok(!/^\s*create policy/m.test(sql.replace(/drop policy if exists[^;]+;\s*create policy/g, '')), 'every policy is drop-if-exists first');
});

test('public surfaces read the safe vendors_public view, not the vendors table', () => {
  assert.match(read('index.html'), /from\('vendors_public'\)/, 'home page vendor row');
  assert.match(read('store/store.js'), /from\('vendors_public'\)/, 'storefront');
  assert.match(read('data/tracking.js'), /from\('vendors_public'\)/, 'order tracking');
  assert.ok(!/from\('vendors'\)\.select\('\*'\)\.eq\('status','approved'\)/.test(read('index.html')), 'no public select(*) on vendors');
});

/* ── 5. ADMIN: full application, decisions recorded, history shown ──── */

test('admin reviews the full application and every decision is recorded to vendor_events', () => {
  const adminHtml = read('admin/index.html');
  assert.match(adminHtml, /vendorHistoryHtml/, 'history section in the vendor detail drawer');
  assert.match(adminHtml, /Correction request/, 'correction requests surface to the admin');
  assert.match(adminHtml, /vdRequestChanges/, 'request-changes flow retained');
  const api = read('api/_lib/routes/admin-vendors.js');
  assert.match(api, /from\('vendor_events'\)\.select/, 'API returns application history');
  assert.match(api, /type: 'status_change'/, 'API records admin decisions');
  assert.match(api, /adminEmails|getAdminEmails/, 'admin authorization stays server-side');
});

/* ── 6. BEHAVIOURAL: real vendor page in jsdom ──────────────────────── */

function makeSignedOutClient() {
  return {
    from: () => {
      const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: () => q, single: () => q,
        insert: () => q, update: () => q, delete: () => q,
        then: res => Promise.resolve({ data: null, error: null }).then(res) };
      return q;
    },
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ data: null, error: { message: 'stub' } }),
      signUp: async () => ({ data: { user: null, session: null }, error: { message: 'stub signup' } }),
      signOut: async () => ({})
    },
    storage: { from: () => ({ upload: async p => ({ data: { path: p } }), getPublicUrl: p => ({ data: { publicUrl: 'https://x/' + p } }) }) },
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} })
  };
}

class LocalOnlyLoader extends ResourceLoader {
  fetch(url) {
    if (url.startsWith('https://vendor.test/')) {
      const p = path.join(ROOT, new URL(url).pathname);
      if (fs.existsSync(p)) return Promise.resolve(Buffer.from(fs.readFileSync(p)));
      return Promise.reject(new Error('not found ' + p));
    }
    return Promise.reject(new Error('no network in seller-center test: ' + url));
  }
}

async function bootVendorPage(query) {
  const html = read('vendor/index.html')
    .replace(/<script src="https:\/\/cdn[^"]*supabase[^"]*"><\/script>/, '')
    .replace(/<script src="https:\/\/unpkg\.com\/leaflet[^"]*"><\/script>/, '');
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(html, {
    url: 'https://vendor.test/vendor/' + (query || ''),
    runScripts: 'dangerously',
    resources: new LocalOnlyLoader(),
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      win.supabase = { createClient: () => makeSignedOutClient() };
      win.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.HTMLElement.prototype.scrollIntoView = function () {};
      win.IntersectionObserver = class { constructor() {} observe() {} unobserve() {} disconnect() {} };
      win.fetch = async () => { throw new Error('no network in seller-center test'); };
    }
  });
  await new Promise(r => setTimeout(r, 1500));
  return dom;
}

test('signed-out + ?intent=register: registration view opens (and never the dashboard)', async () => {
  const dom = await bootVendorPage('?intent=register');
  try {
    const d = dom.window.document;
    assert.equal(d.getElementById('authWrap').style.display, 'flex', 'auth screen shown');
    assert.equal(d.getElementById('authRegView').style.display, '', 'registration view visible');
    assert.equal(d.getElementById('authFormView').style.display, 'none', 'sign-in view hidden');
    assert.ok(!d.getElementById('app').classList.contains('on'), 'dashboard stays locked for signed-out visitors');
  } finally { dom.window.close(); }
});

test('signed-out + ?intent=signin: the dedicated vendor login opens', async () => {
  const dom = await bootVendorPage('?intent=signin');
  try {
    const d = dom.window.document;
    assert.equal(d.getElementById('authFormView').style.display, '', 'sign-in view visible');
    assert.equal(d.getElementById('authRegView').style.display, 'none', 'registration view hidden');
    assert.ok(!d.getElementById('app').classList.contains('on'), 'dashboard stays locked');
    // "Sell on Marcato" on the login sends new sellers to the registration-start screen (asserted statically above;
    // jsdom cannot perform the navigation itself)
    assert.ok(d.getElementById('authGoRegister'), 'Sell on Marcato action present on the login');
  } finally { dom.window.close(); }
});
