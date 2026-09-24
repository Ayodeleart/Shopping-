// POST /api/webhooks/<provider>   e.g. /api/webhooks/paystack  (set this URL in the provider's dashboard)
// The raw body is needed to check the provider's signature, so body parsing is switched off for this function.
const { handler, send, readRaw, HttpError } = require('../_lib/http');
const providers = require('../_lib/payments');
const { processWebhook } = require('../_lib/payments/core');

module.exports = handler(['POST'], async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const id = (req.query && req.query.provider) || url.pathname.split('/').pop();
  if (!providers.registry[id]) throw new HttpError(404, 'Unknown provider', 'unknown_provider');
  const raw = await readRaw(req);
  const out = await processWebhook(id, raw, req.headers);     // 401 on a bad signature, 5xx makes the provider retry
  send(res, 200, { received: true, events: out });
});
module.exports.config = { api: { bodyParser: false } };
