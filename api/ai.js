// Grouped serverless function (Vercel Hobby 12-function cap). Public URLs are mapped here by vercel.json rewrites.
const makeRouter = require('./_lib/route');
module.exports = makeRouter({
  'assistant': () => require('./_lib/routes/assistant'),
  'assistant-ticket': () => require('./_lib/routes/assistant-ticket'),
  'ai-product': () => require('./_lib/routes/ai-product'),
});
