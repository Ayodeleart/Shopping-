// Tiny dispatcher shared by the grouped serverless functions (api/pay.js, api/ai.js, ...).
// Vercel's Hobby plan allows at most 12 functions per deployment, and every file directly under /api counts as one.
// So related endpoints live in api/_lib/routes/ (underscore folders are NOT deployed as functions) and each group file
// below picks the right one. vercel.json rewrites keep the public URLs unchanged: /api/checkout -> /api/pay?fn=checkout.
module.exports = function makeRouter(routes) {
  return async (req, res) => {
    let name = req.query && req.query.fn;
    if (!name) {                                    // direct hit without the rewrite: fall back to the URL's last segment
      try { name = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).pop(); } catch (e) { name = ''; }
    }
    if (!Object.prototype.hasOwnProperty.call(routes, name)) {
      return res.status(404).json({ error: 'Unknown endpoint' });
    }
    return routes[name]()(req, res);                // lazy require: only the requested route's code (and env reads) load
  };
};
