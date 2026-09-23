// /api/wallet-delivery.js
//
// All wallet + delivery-confirmation endpoints live in ONE file, routed by ?action=, so this
// feature only costs the project a single Vercel serverless function slot. (The Hobby plan caps
// a deployment at 12 functions; the repo was already at 12 before this feature, so six separate
// new files would not have deployed. Each action below is otherwise exactly the same, independent
// logic it would have been as its own file — same auth checks, same idempotency guarantees.)
//
// Actions (?action=...):
//   deposit-init       POST  customer starts a real Paystack wallet top-up
//   deposit-webhook     POST  Paystack calls this — register {SITE_URL}/api/wallet-delivery?action=deposit-webhook
//   payment-methods     GET/POST/DELETE  saved cards (Paystack authorization tokens only)
//   checkout             POST  apply wallet balance to an order
//   confirmation-check   GET/POST  cron job — see vercel.json crons (Bearer CRON_SECRET)
//   confirm               POST  customer taps "Yes, I received it" / "Not yet"
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYSTACK_SECRET_KEY, CRON_SECRET,
//      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL, SITE_URL

const crypto = require('crypto');
const { getAdmin, siteUrlFrom } = require('./_lib/db');
const { createPush } = require('./_lib/push');

async function authedUser(req, db) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data: { user }, error } = await db.auth.getUser(token);
  return error ? null : user;
}
function parseBody(req) { return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); }

module.exports = async (req, res) => {
  const action = (req.query && req.query.action) || '';
  const db = getAdmin();

  try {
    // ---------------------------------------------------------------- deposit-init
    if (action === 'deposit-init') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: 'Payments are not configured yet (PAYSTACK_SECRET_KEY missing)' });
      const user = await authedUser(req, db);
      if (!user) return res.status(401).json({ error: 'Invalid session' });
      const amount = Number(parseBody(req).amount);
      if (!Number.isFinite(amount) || amount < 100) return res.status(400).json({ error: 'Minimum deposit is ₦100' });

      const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email, amount: Math.round(amount * 100), currency: 'NGN',
          callback_url: `${siteUrlFrom(req)}/?wallet_deposit=pending`,
          metadata: { user_id: user.id, purpose: 'wallet_deposit' }
        })
      });
      const psData = await psRes.json();
      if (!psRes.ok || !psData.status) return res.status(502).json({ error: psData.message || 'Could not start payment' });
      return res.status(200).json({ authorization_url: psData.data.authorization_url, reference: psData.data.reference });
    }

    // ---------------------------------------------------------------- deposit-webhook
    if (action === 'deposit-webhook') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: 'Not configured' });

      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const signature = req.headers['x-paystack-signature'];
      const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
      if (!signature || signature !== expected) return res.status(401).json({ error: 'Invalid signature' });

      const event = parseBody(req);
      if (event.event !== 'charge.success') return res.status(200).json({ ok: true, ignored: true });
      const reference = event.data && event.data.reference;
      if (!reference) return res.status(400).json({ error: 'Missing reference' });

      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
      const verify = await verifyRes.json();
      if (!verifyRes.ok || !verify.status || !verify.data || verify.data.status !== 'success') {
        return res.status(200).json({ ok: true, skipped: 'not a verified successful charge' });
      }
      const meta = verify.data.metadata || {};
      if (meta.purpose !== 'wallet_deposit' || !meta.user_id) return res.status(200).json({ ok: true, skipped: 'not a wallet deposit transaction' });

      const amount = verify.data.amount / 100;
      const { data, error } = await db.rpc('wallet_credit_deposit', {
        p_user_id: meta.user_id, p_amount: amount, p_provider_reference: reference,
        p_metadata: { channel: verify.data.channel, paid_at: verify.data.paid_at }
      });
      if (error) throw error;
      return res.status(200).json({ ok: true, transaction: data });
    }

    // ---------------------------------------------------------------- payment-methods
    if (action === 'payment-methods') {
      const user = await authedUser(req, db);
      if (!user) return res.status(401).json({ error: 'Invalid session' });

      if (req.method === 'GET') {
        const { data, error } = await db.from('customer_payment_methods')
          .select('id,provider,card_type,last4,bank,exp_month,exp_year,is_default,created_at')
          .eq('user_id', user.id).order('is_default', { ascending: false }).order('created_at', { ascending: false });
        if (error) throw error;
        return res.status(200).json({ payment_methods: data });
      }

      if (req.method === 'POST') {
        if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: 'Payments are not configured yet' });
        const body = parseBody(req);

        if (body.action === 'set_default') {
          if (!body.id) return res.status(400).json({ error: 'id required' });
          await db.from('customer_payment_methods').update({ is_default: false }).eq('user_id', user.id);
          const { error } = await db.from('customer_payment_methods').update({ is_default: true }).eq('id', body.id).eq('user_id', user.id);
          if (error) throw error;
          return res.status(200).json({ ok: true });
        }

        const reference = body.reference;
        if (!reference) return res.status(400).json({ error: 'reference required' });
        const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
          headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
        });
        const verify = await verifyRes.json();
        if (!verifyRes.ok || !verify.status || !verify.data || verify.data.status !== 'success') {
          return res.status(400).json({ error: 'Card verification was not successful' });
        }
        const auth = verify.data.authorization;
        if (!auth || !auth.reusable || !auth.authorization_code) return res.status(400).json({ error: 'This card cannot be saved for future payments' });
        if (verify.data.customer && verify.data.customer.email && verify.data.customer.email.toLowerCase() !== (user.email || '').toLowerCase()) {
          return res.status(400).json({ error: 'Card does not belong to this account' });
        }

        const { count } = await db.from('customer_payment_methods').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
        const { data, error } = await db.from('customer_payment_methods').insert({
          user_id: user.id, provider: 'paystack', provider_customer_code: verify.data.customer && verify.data.customer.customer_code,
          authorization_code: auth.authorization_code, card_type: auth.card_type, last4: auth.last4,
          bank: auth.bank, exp_month: auth.exp_month, exp_year: auth.exp_year, is_default: !count
        }).select().single();
        if (error) {
          if (error.code === '23505') return res.status(200).json({ ok: true, already_saved: true });
          throw error;
        }
        return res.status(200).json({ ok: true, payment_method: data });
      }

      if (req.method === 'DELETE') {
        const id = (req.query && req.query.id) || parseBody(req).id;
        if (!id) return res.status(400).json({ error: 'id required' });
        const { error } = await db.from('customer_payment_methods').delete().eq('id', id).eq('user_id', user.id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ---------------------------------------------------------------- checkout (wallet debit)
    if (action === 'checkout') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const user = await authedUser(req, db);
      if (!user) return res.status(401).json({ error: 'Invalid session' });
      const body = parseBody(req);
      const orderId = Number(body.orderId), amount = Number(body.amount);
      if (!Number.isInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'orderId required' });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amount must be positive' });

      const { data, error } = await db.rpc('wallet_debit_for_order', { p_user_id: user.id, p_order_id: orderId, p_amount: amount });
      if (error) return res.status(400).json({ error: error.message });
      const { data: order } = await db.from('orders').select('id,total,wallet_paid,payment_status').eq('id', orderId).single();
      const { data: wallet } = await db.from('customer_wallets').select('available_balance').eq('user_id', user.id).single();
      return res.status(200).json({ ok: true, transaction: data, order, wallet_balance: wallet ? wallet.available_balance : 0 });
    }

    // ---------------------------------------------------------------- confirmation-check (cron)
    if (action === 'confirmation-check') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

      const push = createPush();
      const { data: eligible, error } = await db.rpc('delivery_confirmation_eligible', { p_limit: 200 });
      if (error) throw error;

      let sent = 0, skipped = 0;
      for (const s of eligible || []) {
        const { data: order } = await db.from('orders').select('id,order_number,address').eq('id', s.order_id).maybeSingle();
        const { data: vendor } = await db.from('vendors').select('business_name').eq('id', s.vendor_id).maybeSingle();
        const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', s.user_id).eq('role', 'buyer');

        if (subs && subs.length && push.configured) {
          const vendorName = (vendor && vendor.business_name) || 'your seller';
          const when = s.expected_delivery_at ? new Date(s.expected_delivery_at).toLocaleString('en-NG', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : 'recently';
          const payload = {
            title: 'Did your Marcato order arrive?',
            body: `Your order from ${vendorName} was expected around ${when}. Have you received it?`,
            url: `${siteUrlFrom(req)}/?confirm_delivery=${s.shipment_id}`,
            tag: `delivery-confirm-${s.shipment_id}`
          };
          for (const sub of subs) {
            const r = await push.send(sub, payload);
            if (r.dead) await db.from('push_subscriptions').delete().eq('id', sub.id);
          }
          sent++;
        } else {
          skipped++;
        }
        await db.rpc('delivery_confirmation_mark_prompted', { p_shipment_id: s.shipment_id, p_order_id: s.order_id, p_user_id: s.user_id });
      }
      return res.status(200).json({ ok: true, eligible: (eligible || []).length, sent, skipped });
    }

    // ---------------------------------------------------------------- confirm
    if (action === 'confirm') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const user = await authedUser(req, db);
      if (!user) return res.status(401).json({ error: 'Invalid session' });
      const body = parseBody(req);
      const shipmentId = Number(body.shipmentId), response = body.response;
      if (!Number.isInteger(shipmentId) || shipmentId <= 0) return res.status(400).json({ error: 'shipmentId required' });
      if (!['yes', 'not_yet'].includes(response)) return res.status(400).json({ error: 'response must be yes or not_yet' });

      const { data, error } = await db.rpc('delivery_confirm', { p_shipment_id: shipmentId, p_user_id: user.id, p_response: response });
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ ok: true, shipment: data });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
};
