// GET /api/banks -> list of banks from the payment provider (for the seller payout form)
const { handler, send, HttpError } = require('../http');
const { requireUser } = require('../auth');
const providers = require('../payments');

let cache = { at: 0, banks: [] };
module.exports = handler(['GET'], async (req, res) => {
  await requireUser(req);
  const p = providers.active();
  if (!p) throw new HttpError(503, 'Payments are not configured yet.', 'payments_not_configured');
  if (Date.now() - cache.at > 6 * 3600 * 1000 || !cache.banks.length) cache = { at: Date.now(), banks: await p.listBanks() };
  send(res, 200, { banks: cache.banks });
});
