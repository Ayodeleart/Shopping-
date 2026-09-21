// Web Push sender. Uses the same VAPID keys as the rest of the app (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CONTACT_EMAIL).
// `transport` is injectable so the dispatcher can be tested without a network.

function createPush(env = process.env, transport) {
  const configured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  let wp = transport;
  if (!wp && configured) {
    wp = require('web-push');
    wp.setVapidDetails(env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  }
  return {
    configured: configured || !!transport,
    // resolves { ok: true } | { ok: false, dead: true } (subscription gone) | { ok: false, error }
    async send(sub, payload, opts = {}) {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify(payload),
          { TTL: opts.ttl || 60 * 60 * 24, topic: opts.topic, urgency: opts.urgency || 'normal' }
        );
        return { ok: true };
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) return { ok: false, dead: true };
        return { ok: false, error: (err && (err.body || err.message)) || String(err) };
      }
    }
  };
}

module.exports = { createPush };
