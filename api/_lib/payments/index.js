/* Payment provider layer
 *
 * Checkout, webhooks, refunds and payouts never talk to Paystack (or any gateway) directly. They talk to a
 * PaymentProvider, chosen by the PAYMENT_PROVIDER environment variable. To add Flutterwave, Monnify, Interswitch,
 * Remita, Squad and so on, write one file that exports the same shape and register it below.
 *
 * PaymentProvider
 *   id                          'paystack'
 *   isTest                      true when the credentials in use move no real money (sandbox / mock)
 *   requiredEnv                 names of the environment variables the provider needs
 *   configured()                true when every required variable is set
 *   methods()                   [{ id, label, hint }]  payment methods to offer the customer
 *   initializePayment({ reference, amount, currency, email, method, callbackUrl, metadata })
 *                                 -> { authorizationUrl, providerReference }
 *   verifyPayment(reference)    -> { status: 'successful'|'failed'|'pending', amount, currency, method, providerTxnId, fee, raw }
 *   parseWebhook(rawBody, headers)
 *                               -> { events: [{ eventId, type, reference, providerTxnId, ... }] }   throws on a bad signature
 *                                  types: payment.success | payment.failed | refund.processed | refund.failed |
 *                                         payout.success | payout.failed | payout.reversed
 *   refundPayment({ reference, providerTxnId, amount, reason, refundReference })
 *                               -> { status: 'processed'|'pending'|'failed', providerRefundId }
 *   createPayout({ reference, amount, reason, recipient: { name, bankCode, accountNumber, code? } })
 *                               -> { status: 'paid'|'processing'|'failed', transferId, recipientCode }
 *   checkPayoutStatus(reference) -> { status: 'paid'|'processing'|'failed'|'reversed', transferId }
 *   listBanks()                 -> [{ name, code }]
 *
 * Amounts inside Marcato are naira (decimal). Each provider converts to its own unit (kobo for Paystack).
 */
const { HttpError } = require('../http');

const registry = {
  paystack: () => require('./paystack'),
  mock: () => require('./mock')
};

function get(id) {
  const load = registry[id];
  if (!load) throw new HttpError(500, `Unknown payment provider "${id}"`, 'unknown_provider');
  return load();
}

// Which provider id is selected. PAYMENT_PROVIDER wins. When it is not set but Paystack's secret key is, Paystack is
// used: a store that has added its Paystack key should not silently show "payment not available" just because a
// second variable was forgotten. This never falls back to the mock provider, and never applies when PAYMENT_PROVIDER is
// set to something else (including an unknown value, which stays an error).
function selectedId() {
  const id = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  if (id) return id;
  return (process.env.PAYSTACK_SECRET_KEY || '').trim() ? 'paystack' : '';
}

// The provider new checkouts use. Returns null when nothing usable is configured.
function active() {
  const id = selectedId();
  if (!id || !registry[id]) return null;
  const p = get(id);
  return p.configured() ? p : null;
}

// Why active() is null, as a short code the checkout page can act on (no values, no variable names).
function inactiveReason() {
  const id = selectedId();
  if (!id) return 'provider_not_selected';
  if (!registry[id]) return 'unknown_provider';
  return get(id).configured() ? null : 'missing_credentials';
}

// For the admin screen: what is configured and what is missing (names only, never values)
function status() {
  const id = selectedId();
  const info = { selected: id || null, inferred: !(process.env.PAYMENT_PROVIDER || '').trim() && !!id, available: Object.keys(registry), configured: false, isTest: null, missing: [] };
  if (!id) { info.missing = ['PAYMENT_PROVIDER']; return info; }
  if (!registry[id]) { info.missing = ['PAYMENT_PROVIDER (unknown: ' + id + ')']; return info; }
  const p = get(id);
  info.missing = p.requiredEnv.filter(k => !process.env[k]);
  info.configured = p.configured();
  info.isTest = info.configured ? p.isTest : null;
  info.requiredEnv = p.requiredEnv;
  return info;
}

module.exports = { get, active, status, inactiveReason, selectedId, registry };
