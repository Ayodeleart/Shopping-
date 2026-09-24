// Grouped serverless function (Vercel Hobby 12-function cap). Public URLs are mapped here by vercel.json rewrites.
const makeRouter = require('./_lib/route');
module.exports = makeRouter({
  'check-slug': () => require('./_lib/routes/check-slug'),
  'verify-identity': () => require('./_lib/routes/verify-identity'),
  'verify-bank': () => require('./_lib/routes/verify-bank'),
});
