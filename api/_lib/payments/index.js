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

// The provider new checkouts use (from PAYMENT_PROVIDER). Returns null when nothing usable is configured.
function active() {
  const id = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  if (!id || !registry[id]) return null;
  const p = get(id);
  return p.configured() ? p : null;
}

// For the admin screen: what is configured and what is missing (names only, never values)
function status() {
  const id = (process.env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  const info = { selected: id || null, available: Object.keys(registry), configured: false, isTest: null, missing: [] };
  if (!id) { info.missing = ['PAYMENT_PROVIDER']; return info; }
  if (!registry[id]) { info.missing = ['PAYMENT_PROVIDER (unknown: ' + id + ')']; return info; }
  const p = get(id);
  info.missing = p.requiredEnv.filter(k => !process.env[k]);
  info.configured = p.configured();
  info.isTest = info.configured ? p.isTest : null;
  info.requiredEnv = p.requiredEnv;
  return info;
}

module.exports = { get, active, status, registry };
