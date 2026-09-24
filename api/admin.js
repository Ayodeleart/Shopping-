// Grouped serverless function (Vercel Hobby 12-function cap). Public URLs are mapped here by vercel.json rewrites.
const makeRouter = require('./_lib/route');
module.exports = makeRouter({
  'admin-payments': () => require('./_lib/routes/admin-payments'),
  'admin-vendors': () => require('./_lib/routes/admin-vendors'),
});
