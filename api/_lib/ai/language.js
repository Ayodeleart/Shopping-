// Language handling + complaint/escalation classification (lightweight, deterministic, no AI call).

const LANGS = {
  en: { name: 'English', guide: 'Reply in clear, friendly English.' },
  pcm: { name: 'Nigerian Pidgin', guide: 'Reply in natural, respectful Nigerian Pidgin (for example "No wahala", "I go check", "Wetin you wan buy?", "abeg"). Keep it easy to read.' },
  yo: { name: 'Yoruba', guide: 'Reply in Yoruba, using tone marks and dots under letters (ẹ, ọ, ṣ) where you are confident. Keep sentences short and simple.' },
  ig: { name: 'Igbo', guide: 'Reply in Igbo, using standard Igbo spelling (ị, ọ, ụ) where you are confident. Keep sentences short and simple.' },
  ha: { name: 'Hausa', guide: 'Reply in Hausa. Keep sentences short and simple.' }
};

const MARKERS = {
  pcm: ['abeg', 'wetin', 'wey', 'no wahala', 'dey', 'una ', 'i fit', 'fit help', 'wan buy', 'na so', 'sabi', 'oga', 'how far', 'shey', 'make i', 'dem don'],
  yo: ['mo n wa', 'mo fẹ', 'mo fe ', 'ọja', 'bata', 'jọwọ', 'jowo', 'ṣe', 'ti ko ju', 'ọlọ', 'melo ni', 'owo', 'e jowo', 'kí ni', 'bawo'],
  ig: ['achọrọ', 'achoro', 'ekwentị', 'ekwenti', 'dị ọnụ', 'biko', 'kedu', 'ọnụ ahịa', 'ahịa', 'nna', 'daalụ', 'gịnị', 'ego'],
  ha: ['ina neman', 'waya', 'mai araha', 'nawa', 'don allah', 'sannu', 'kudi', 'ina son', 'yaya', 'kaya', 'na gode', 'akwai']
};

/** Best-guess language of one message, or null when there is no clear signal (English is the fallback). */
function detectLanguage(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  let best = null, bestScore = 0;
  Object.keys(MARKERS).forEach(k => {
    const score = MARKERS[k].reduce((n, m) => n + (t.includes(m) ? 1 : 0), 0);
    if (score > bestScore) { best = k; bestScore = score; }
  });
  return bestScore >= 1 ? best : null;
}

/* ---- complaint classification ------------------------------------------------------------ */
// order of the array = priority when several match. `escalate` topics always go to a human.
const TOPICS = [
  { key: 'safety', escalate: true, re: /\b(injur\w*|burn(?:ed|t)?|caught fire|on fire|exploded|explosion|electric(?:al)? shock|poison\w*|allergic reaction|hospital|choking|unsafe)\b/i },
  { key: 'threat_harassment', escalate: true, re: /\b(threat\w*|harass\w*|i will kill|kill you|beat you|blackmail|stalk\w*|abus(?:e|ed|ing) me)\b/i },
  { key: 'fraud', escalate: true, re: /\b(fraud\w*|scam\w*|419|phishing|fake seller|stole|stolen|steal|thief|thieves|unauthori[sz]ed|jibiti|zamba|yaudara|agh[ụu]gh[ọo])\b/i },
  { key: 'account_security', escalate: true, re: /\b(hack\w*|account (?:was )?(?:taken|compromised)|someone (?:logged|is using)|took over my account|not me who)\b/i },
  { key: 'payment_suspicious', escalate: true, re: /\b(debited (?:twice|two times|but)|charged (?:twice|two times)|double (?:charge|debit)|money (?:was )?(?:deducted|debited)|unknown (?:charge|debit)|suspicious (?:payment|charge|transaction))\b/i },
  { key: 'legal', escalate: true, re: /\b(lawyer|attorney|sue\b|suing|court|legal action|police|fccpc|consumer protection|report you to)\b/i },
  { key: 'refund_dispute', escalate: true, re: /\b(refund\w*|chargeback|money back|return my money|give me my money|reverse (?:the )?payment)\b/i },
  { key: 'medical', escalate: true, re: /\b(cure[sd]?|treat(?:s|ed)? (?:my )?(?:disease|illness|condition)|medical advice|prescription|diabet\w*|cancer|hiv)\b/i },
  { key: 'missing_order', escalate: false, re: /\b((?:never|not) (?:yet )?(?:been )?(?:got|received|delivered|arrived)|missing order|where is my order|wrong item|different item|damaged|broken|defective|late delivery|delayed)\b/i },
  { key: 'general_complaint', escalate: false, re: /\b(complain\w*|disappointed|terrible service|worst|not happy|unhappy|bad service)\b/i }
];

/** -> { key, escalate } for the first matching topic, or null. */
function classifyComplaint(text) {
  const t = String(text || '');
  for (const topic of TOPICS) if (topic.re.test(t)) return { key: topic.key, escalate: topic.escalate };
  return null;
}

const ESCALATE_KEYS = TOPICS.filter(t => t.escalate).map(t => t.key);

module.exports = { LANGS, detectLanguage, classifyComplaint, ESCALATE_KEYS };
