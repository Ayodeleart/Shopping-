// Grouped serverless function (Vercel Hobby 12-function cap). Public URLs are mapped here by vercel.json rewrites.
const makeRouter = require('./_lib/route');
module.exports = makeRouter({
  'notify-order': () => require('./_lib/routes/notify-order'),
  'notify-dispatch': () => require('./_lib/routes/notify-dispatch'),
  'notify-broadcast': () => require('./_lib/routes/notify-broadcast'),
});
