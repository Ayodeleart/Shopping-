// Server-side Groq client (OpenAI-compatible chat completions). The API key never leaves the server.
// Every failure is turned into an AIError whose `publicMessage` is safe to show to a customer/vendor.

class AIError extends Error {
  constructor(code, publicMessage, status, extra) {
    super(code);
    this.code = code;                 // not_configured | rate_limited | timeout | upstream | bad_output | bad_request
    this.publicMessage = publicMessage;
    this.status = status || 500;
    Object.assign(this, extra || {});
  }
}

const cfg = () => ({
  key: process.env.GROQ_API_KEY,
  base: (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
  textModel: process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b',
  visionModel: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
  effort: process.env.GROQ_REASONING_EFFORT || ''
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * chat({ model, messages, tools, json, temperature, maxTokens, timeoutMs, fetchImpl })
 * -> { message, usage }   message = { role, content, tool_calls? }
 * Retries 429/5xx up to twice (honouring a short Retry-After); never throws provider text to callers.
 */
async function chat(opts) {
  const c = cfg();
  if (!c.key) throw new AIError('not_configured', 'The AI assistant is not set up yet. Please try again later.', 503);
  const f = opts.fetchImpl || fetch;
  const body = {
    model: opts.model || c.textModel,
    messages: opts.messages,
    temperature: opts.temperature == null ? 0.3 : opts.temperature,
    max_completion_tokens: opts.maxTokens || 1500
  };
  if (c.effort) body.reasoning_effort = c.effort;
  if (opts.tools && opts.tools.length) { body.tools = opts.tools; body.tool_choice = 'auto'; }
  if (opts.json) body.response_format = { type: 'json_object' };

  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 25000);
    try {
      const res = await f(c.base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
        body: JSON.stringify(body),
        signal: ctl.signal
      });
      lastStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        const message = data && data.choices && data.choices[0] && data.choices[0].message;
        if (!message) throw new AIError('upstream', 'The AI service returned an empty answer. Please try again.', 502);
        return { message, usage: data.usage || null };
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        await sleep(Math.min(ra > 0 ? ra * 1000 : 600 * (attempt + 1), 2500));
        continue;
      }
      if (res.status === 429) throw new AIError('rate_limited', 'The assistant is busy right now. Please try again in a moment.', 429);
      if (res.status === 401 || res.status === 403) {
        console.error('[ai] provider rejected the API key');
        throw new AIError('not_configured', 'The AI assistant is not available right now. Please try again later.', 503);
      }
      console.error('[ai] provider error status', res.status);   // status only: never log provider bodies or prompts
      throw new AIError('upstream', 'The AI service had a problem. Please try again.', 502, { upstreamStatus: res.status });
    } catch (e) {
      if (e instanceof AIError) throw e;
      if (e && e.name === 'AbortError') {
        if (attempt < 2) continue;
        throw new AIError('timeout', 'The AI service took too long to answer. Please try again.', 504);
      }
      if (attempt < 2) { await sleep(400); continue; }
      console.error('[ai] network error', e && e.code);
      throw new AIError('upstream', 'Could not reach the AI service. Please try again.', 502);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AIError('upstream', 'The AI service had a problem. Please try again.', lastStatus === 429 ? 429 : 502);
}

// reasoning models sometimes wrap thoughts in <think>…</think>; never show those
const cleanText = s => String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

// pulls the first JSON object out of a model answer (handles ```json fences)
function parseJsonObject(text) {
  const t = cleanText(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

module.exports = { AIError, chat, cleanText, parseJsonObject, config: cfg };
