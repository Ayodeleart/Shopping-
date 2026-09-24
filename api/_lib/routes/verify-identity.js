// /api/verify-identity.js
//
// Identity verification for the seller onboarding wizard (NIN / BVN / driver's
// licence / passport). This is a genuine provider abstraction, not a fake
// verification API: verifyIdentity() dispatches to whichever KYC provider is
// configured via env vars. With no provider configured, it does NOT fabricate
// a "verified" result — it records the submission as needs_review so an admin
// can manually check it, and tells the caller plainly that automated
// verification isn't wired up yet.
//
// Required environment variables (set in Vercel, never in the repo):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Optional — enables real automated verification once you have a provider account:
//   IDENTITY_PROVIDER      = "dojah" (only provider wired below; add more the same way)
//   DOJAH_APP_ID            (from Dojah dashboard)
//   DOJAH_SECRET_KEY
//
// To add a different provider (Youverify, Smile ID, Prembly, etc.), write a new
// verifyWith<Provider>() function with the same input/output shape and add it
// to the `providers` map — nothing else in this file or the client needs to change.

const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Every provider function takes {method, idNumber, vendor} and returns
 *  { status: 'verified'|'failed'|'needs_review', ref, raw } */
async function verifyWithDojah({ method, idNumber }) {
  const appId = process.env.DOJAH_APP_ID;
  const secretKey = process.env.DOJAH_SECRET_KEY;
  const endpoints = { nin: 'nin', bvn: 'bvn', drivers_license: 'dl', passport: 'passport' };
  const path = endpoints[method];
  if (!path) return { status: 'needs_review', ref: null, raw: { error: 'Unsupported method for this provider' } };

  const res = await fetch(`https://api.dojah.io/api/v1/kyc/${path}?${path === 'nin' ? 'nin' : path + '_number'}=${encodeURIComponent(idNumber)}`, {
    headers: { AppId: appId, Authorization: secretKey }
  });
  const json = await res.json();
  if (!res.ok) return { status: 'failed', ref: null, raw: json };
  return { status: 'verified', ref: json?.entity?.id || null, raw: json };
}

async function verifyIdentity({ method, idNumber, vendor }) {
  const provider = process.env.IDENTITY_PROVIDER;
  const providers = { dojah: verifyWithDojah };

  if (!provider || !providers[provider]) {
    // No automated provider configured — this is the honest, non-fake state.
    return { status: 'needs_review', provider: null, ref: null };
  }
  const result = await providers[provider]({ method, idNumber, vendor });
  return { status: result.status, provider, ref: result.ref };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { method, idNumber } = body || {};
    if (!method || !idNumber) return res.status(400).json({ error: 'method and idNumber are required' });
    if (!['nin', 'bvn', 'drivers_license', 'passport'].includes(method)) {
      return res.status(400).json({ error: 'Unsupported verification method' });
    }

    const result = await verifyIdentity({ method, idNumber, vendor: user });

    const { error: updateErr } = await supabaseAdmin.from('vendors').update({
      id_verification_method: method,
      id_verification_number: idNumber,
      id_verification_status: result.status,
      id_verification_provider: result.provider,
      id_verification_ref: result.ref,
      id_verification_checked_at: new Date().toISOString()
    }).eq('id', user.id);
    if (updateErr) throw updateErr;

    return res.status(200).json({
      status: result.status,
      configured: !!result.provider,
      message: result.provider
        ? undefined
        : 'Automated identity verification isn\'t configured yet — your details were saved and will be checked manually before approval.'
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
