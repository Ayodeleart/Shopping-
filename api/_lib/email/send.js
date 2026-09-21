// Email provider. Resend is used when RESEND_API_KEY and EMAIL_FROM are set in the hosting environment.
// Nothing is sent, and nothing pretends to be sent, until both exist: `configured` is false and the dispatcher records
// the delivery as skipped ("email_not_configured"). To use another provider, return an object with the same shape.

function createEmail(env = process.env, fetchImpl) {
  const key = env.RESEND_API_KEY, from = env.EMAIL_FROM;
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  return {
    name: 'resend',
    configured: !!(key && from && doFetch),
    // resolves { ok: true, id } | { ok: false, error, retry }
    async send({ to, subject, html, text, idempotencyKey }) {
      try {
        const res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: Object.assign({ Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          body: JSON.stringify({ from, to: [to], subject, html, text })
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) return { ok: true, id: body.id || null };
        // 4xx (except rate limits) will not get better by retrying
        return { ok: false, error: `Resend ${res.status}: ${body.message || body.name || 'error'}`, retry: res.status === 429 || res.status >= 500 };
      } catch (e) {
        return { ok: false, error: 'Email request failed: ' + (e && e.message), retry: true };
      }
    }
  };
}

module.exports = { createEmail };
