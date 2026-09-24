// Grouped serverless function (Vercel Hobby 12-function cap). Public URLs are mapped here by vercel.json rewrites.
const makeRouter = require('./_lib/route');
module.exports = makeRouter({
  'brand-search': () => require('./_lib/routes/brand-search'),
  'geocode': () => require('./_lib/routes/geocode'),
});
