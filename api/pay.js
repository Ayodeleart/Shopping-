// Grouped serverless function (Vercel Hobby 12-function cap). Public URLs are mapped here by vercel.json rewrites.
const makeRouter = require('./_lib/route');
module.exports = makeRouter({
  'checkout': () => require('./_lib/routes/checkout'),
  'payment-methods': () => require('./_lib/routes/payment-methods'),
  'payment-verify': () => require('./_lib/routes/payment-verify'),
  'order-status': () => require('./_lib/routes/order-status'),
  'banks': () => require('./_lib/routes/banks'),
  'mock-pay': () => require('./_lib/routes/mock-pay'),
});
