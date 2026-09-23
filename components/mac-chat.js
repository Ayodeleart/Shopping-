/* Pcx.MacChat: the chat panel MAC opens.
 *
 * A bottom sheet (a side card on wider screens) that talks to the store's existing shopping-assistant API —
 * /api/assistant and /api/assistant-ticket, both already wired to Groq server-side. This component only renders
 * what the server sends back (text, product cards, comparisons, order lookups, add-to-cart / sign-in prompts,
 * and the support-ticket confirm step) — it does not talk to any AI provider itself and carries no key.
 *
 * Settings (gear icon, between "new chat" and "close"): choosing a language here changes every label in this
 * panel, not just the greeting — placeholders, buttons, availability text, errors, all of it — and is sent to
 * the server as a locked choice, so the model's own replies switch language too. Choosing a colour (including
 * a Pride swatch) restyles MAC via Pcx.macTheme (components/mac-theme.js) and applies everywhere MAC appears.
 *
 * It mounts itself once the page is ready. To wire it to your store, set `window.MAC_CHAT_MANUAL = true` first:
 *
 *   const chat = new Pcx.MacChat({
 *     mac: Pcx.mac,                                 // the MacFab to bounce while thinking, and to hide while open
 *     endpoint: '/api/assistant', ticketEndpoint: '/api/assistant-ticket',
 *     getSession: () => buyerSession,                // Supabase session or null — adds the auth header for order lookups
 *     getStoreName: () => storeName, fmt, currency,
 *     onNavigate: fn => { chat.close(); fn(); },     // close the sheet, then run the action
 *     openProduct: id => ..., openOrder: id => ..., openSignIn: () => ..., addToCart: (id, qty) => ...
 *   });
 *
 * Methods: open()  close()  toggle()  reset()  ask(text)
 */
(function (global) {
  'use strict';
  var Pcx = global.Pcx = global.Pcx || {};

  var SESSION_KEY = 'mac_chat_v1', LANG_KEY = 'ai_lang_pref';    // ai_lang_pref: kept from the old assistant so a returning shopper's language choice still sticks
  var LANGS = [['en', 'English'], ['pcm', 'Nigerian Pidgin'], ['yo', 'Yoruba'], ['ig', 'Igbo'], ['ha', 'Hausa']];
  var GREET = {
    en: ['Hi, I\u2019m MAC', 'Ask me about any product, compare options, or get help with an order.'],
    pcm: ['How far! Na me be MAC', 'Ask me about any product, I go help you find am. I fit help with your order too.'],
    yo: ['Bawo! MAC ni mi', 'B\u00e9\u00e8r\u00e8 l\u1ecdw\u1ecd mi n\u00edpa \u1ecdj\u00e0 kank\u00e0n, t\u00e0b\u00ed n\u00edpa \u00ecb\u00e9\u00e8r\u00e8 r\u1eb9.'],
    ig: ['Nn\u1ecd\u1ecd! Ab\u1ee5 m MAC', 'J\u1ee5\u1ecd m maka ngwaah\u1ecba \u1ecd b\u1ee5la ma \u1ecd b\u1ee5 maka ihe \u1ecb nwere.'],
    ha: ['Sannu! Ni ne MAC', 'Tambaye ni game da kowane kaya ko taimako da oda.']
  };

  /* Every other visible string in this panel, in the same five languages as the greeting above and the server's
     own system prompt. These are a good-faith, non-native translation, not a professional one — worth a native
     speaker's review before this ships. English is the fallback for anything a language is missing. */
  var STR = {
    en: {
      subtitle: 'Shopping helper', placeholder: 'Ask MAC anything', inputLabel: 'Message to MAC',
      disclaimer: 'MAC is an AI helper and can make mistakes. Check details on the product page.',
      newChat: 'Start a new chat', confirmClear: 'Tap again to clear this conversation', closeChat: 'Close chat',
      settingsBtn: 'Settings', backBtn: 'Back', settingsTitle: 'Settings', langLabel: 'Language', colorLabel: 'MAC colour',
      replay: 'Replay MAC\u2019s routine', dialogLabel: 'Chat with MAC', tryAgain: 'Try again', send: 'Send',
      viewProduct: 'View product', open: 'Open', addToCart: 'Add to cart', noThanks: 'No thanks',
      added: 'Added', addedMsg: 'Added to your cart.', notAddedMsg: 'Okay, not added.', signIn: 'Sign in', view: 'View',
      inStock: 'In stock', lowStock: 'Only a few left', outStock: 'Out of stock', addQ: 'Add to cart?',
      sendTicketQ: 'Send this to support?', ticketSent: 'Sent to support', ticketNothing: 'Nothing was sent.',
      submitTicket: 'Submit to support', sending: 'Sending\u2026', cancel: 'Cancel', ref: 'Reference',
      cancelledMsg: 'Okay, I have not sent anything to support.',
      genericErr: 'Something went wrong. Please try again.', timeoutErr: 'That took too long. Please try again.',
      connErr: 'I could not reach MAC. Check your connection and try again.',
      ticketFail: 'We could not send it. Please try again.', noConn: 'No connection. Please try again.',
      chips: ['Find me something under \u20a650,000', 'Show me new products', 'Help me choose a gift', 'Compare two products', 'I need help with an order']
    },
    pcm: {
      subtitle: 'E dey help you shop', placeholder: 'Ask MAC anytin', inputLabel: 'Message to MAC',
      disclaimer: 'MAC fit make mistake sometimes. Check the product page well well before you buy.',
      newChat: 'Start new chat', confirmClear: 'Tap again make e clear this chat', closeChat: 'Close the chat',
      settingsBtn: 'Settings', backBtn: 'Back', settingsTitle: 'Settings', langLabel: 'Language', colorLabel: 'MAC colour',
      replay: 'Make MAC do e thing again', dialogLabel: 'Chat with MAC', tryAgain: 'Try again', send: 'Send',
      viewProduct: 'See the product', open: 'Open', addToCart: 'Add am to cart', noThanks: 'No, thank you',
      added: 'Don add am', addedMsg: 'I don add am to your cart.', notAddedMsg: 'Ok, I no add am.', signIn: 'Sign in', view: 'See am',
      inStock: 'E dey available', lowStock: 'Small remain', outStock: 'E don finish', addQ: 'You wan make I add am to cart?',
      sendTicketQ: 'You wan make I send dis one go support?', ticketSent: 'I don send am go support', ticketNothing: 'I no send anything.',
      submitTicket: 'Send am go support', sending: 'I dey send am\u2026', cancel: 'Cancel', ref: 'Reference',
      cancelledMsg: 'Ok, I no send anything go support.',
      genericErr: 'Something happen. Abeg try again.', timeoutErr: 'E take too long. Abeg try again.',
      connErr: 'I no fit reach MAC. Check your network make you try again.',
      ticketFail: 'We no fit send am. Abeg try again.', noConn: 'No network. Abeg try again.',
      chips: ['Find something wey no pass \u20a650,000', 'Show me new products', 'Help me choose gift', 'Compare two products', 'I need help with order']
    },
    yo: {
      subtitle: 'Olù\u00ecran\u0323lọwọ ríra ọjà', placeholder: 'B\u00e9\u00e8r\u00e8 l\u1ecdw\u1ecd MAC ohunk\u00f3hun', inputLabel: 'Ọ̀rọ̀ sí MAC',
      disclaimer: 'MAC lè ṣàṣìṣe nígbà mìíràn. Ṣàyẹ̀wò ojú ìwé ọjà náà kí o tó rà á.',
      newChat: 'Bẹ̀rẹ̀ ìjíròrò tuntun', confirmClear: 'Tẹ̀ ẹ́ ẹ̀ẹ̀kan sí i láti pa ìjíròrò yìí rẹ́', closeChat: 'Ti ìjíròrò náà',
      settingsBtn: 'Ètò', backBtn: 'Padà', settingsTitle: 'Ètò', langLabel: 'Èdè', colorLabel: 'Àwọ̀ MAC',
      replay: 'Tún eré MAC ṣe', dialogLabel: 'Bá MAC sọ̀rọ̀', tryAgain: 'Gbìyànjú lẹ́ẹ̀kan si', send: 'Fi ránṣẹ́',
      viewProduct: 'Wo ọjà náà', open: 'Ṣí', addToCart: 'Fi kún kẹ̀kẹ́ rírà', noThanks: 'Rárá, o ṣeun',
      added: 'A ti fi kún un', addedMsg: 'Mo ti fi kún kẹ̀kẹ́ rírà rẹ.', notAddedMsg: 'Ó dáa, n kò fi kún un.', signIn: 'Wọlé', view: 'Wo',
      inStock: 'Ó wà', lowStock: 'Díẹ̀ ló ku', outStock: 'Kò sí mọ́', addQ: 'Ṣé kí n fi kún kẹ̀kẹ́ rírà?',
      sendTicketQ: 'Ṣé kí n fi èyí ránṣẹ́ sí àtìlẹ́yìn?', ticketSent: 'A ti fi ránṣẹ́ sí àtìlẹ́yìn', ticketNothing: 'Èmi kò fi ohunkóhun ránṣẹ́.',
      submitTicket: 'Fi ránṣẹ́ sí àtìlẹ́yìn', sending: 'Ń fi ránṣẹ́\u2026', cancel: 'Fagilé', ref: 'Nọ́mbà ìtọ́kasí',
      cancelledMsg: 'Ó dáa, n kò fi ohunkóhun ránṣẹ́ sí àtìlẹ́yìn.',
      genericErr: 'Àṣìṣe ṣẹlẹ̀. Jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan si.', timeoutErr: 'Ó gùn ju. Jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan si.',
      connErr: 'N kò le dé ọ̀dọ̀ MAC. Ṣàyẹ̀wò nẹ́tíwọ́kì rẹ kí o gbìyànjú lẹ́ẹ̀kan si.',
      ticketFail: 'A kò lè fi ránṣẹ́. Jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan si.', noConn: 'Kò sí nẹ́tíwọ́kì. Jọ̀wọ́ gbìyànjú lẹ́ẹ̀kan si.',
      chips: ['Wá n\u01f9\u0301kan tí kò ju \u20a650,000 lọ', 'Fi ọjà tuntun hàn mí', 'Ràn mí lọ́wọ́ láti yan ẹ̀bùn', 'Fi ọjà méjì wéra', 'Mo nílò ìrànlọ́wọ́ pẹ̀lú àṣẹ mi']
    },
    ig: {
      subtitle: 'Onye enyemaka ịzụ ahịa', placeholder: 'Jụọ MAC ihe ọ bụla', inputLabel: 'Ozi gaa na MAC',
      disclaimer: 'MAC nwere ike imehie mgbe ụfọdụ. Lelee peeji ngwaahịa tupu ịzụta ya.',
      newChat: 'Malite mkparịta ụka ọhụrụ', confirmClear: 'Pịa ọzọ ka ị hichaa mkparịta ụka a', closeChat: 'Mechie mkparịta ụka',
      settingsBtn: 'Ntọala', backBtn: 'Laghachi', settingsTitle: 'Ntọala', langLabel: 'Asụsụ', colorLabel: 'Agba MAC',
      replay: 'Kpọghachite ihe ngosi MAC', dialogLabel: 'Kparịta ụka na MAC', tryAgain: 'Nwaa ọzọ', send: 'Ziga',
      viewProduct: 'Lee ngwaahịa', open: 'Mepee', addToCart: 'Tinye na nkata', noThanks: 'Mba, daalụ',
      added: 'Etinyela', addedMsg: 'Etinyela ya na nkata gị.', notAddedMsg: 'Ọ dị mma, etinyeghị m ya.', signIn: 'Banye', view: 'Lee',
      inStock: 'Dị', lowStock: 'Fọdụrụ ntakịrị', outStock: 'Adịghị', addQ: 'Ka m tinye ya na nkata?',
      sendTicketQ: 'Ka m ziga nke a na ndị nkwado?', ticketSent: 'Ezigala ya na ndị nkwado', ticketNothing: 'Ezighị m ihe ọ bụla.',
      submitTicket: 'Ziga ndị nkwado', sending: 'Na-eziga\u2026', cancel: 'Kagbuo', ref: 'Nọmba ntụaka',
      cancelledMsg: 'Ọ dị mma, ezighị m ihe ọ bụla na ndị nkwado.',
      genericErr: 'Ihe adịghị mma mere. Biko nwaa ọzọ.', timeoutErr: 'O were oge ogologo. Biko nwaa ọzọ.',
      connErr: 'Enweghị m ike iru MAC. Lelee netwọk gị ma nwaa ọzọ.',
      ticketFail: 'Anyị enweghị ike iziga ya. Biko nwaa ọzọ.', noConn: 'Enweghị netwọk. Biko nwaa ọzọ.',
      chips: ['Chọtara m ihe na-erughị \u20a650,000', 'Gosi m ngwaahịa ọhụrụ', 'Nyere m aka ịhọrọ onyinye', 'Tụnyere ngwaahịa abụọ', 'Achọrọ m enyemaka na iwu m']
    },
    ha: {
      subtitle: 'Mataimaki na siyayya', placeholder: 'Tambayi MAC kowane abu', inputLabel: 'Saƙo zuwa MAC',
      disclaimer: 'MAC na iya yin kuskure wani lokaci. Duba shafin kayan kafin ka saya.',
      newChat: 'Fara sabon hira', confirmClear: 'Danna kuma don share wannan hirar', closeChat: 'Rufe hira',
      settingsBtn: 'Saitunan', backBtn: 'Baya', settingsTitle: 'Saitunan', langLabel: 'Harshe', colorLabel: 'Launin MAC',
      replay: 'Sake wasan MAC', dialogLabel: 'Hira da MAC', tryAgain: 'Sake gwadawa', send: 'Aika',
      viewProduct: 'Duba kaya', open: 'Buɗe', addToCart: 'Ƙara zuwa kwando', noThanks: 'A\u2019a, na gode',
      added: 'An ƙara', addedMsg: 'An ƙara shi zuwa kwandon ka.', notAddedMsg: 'To, ban ƙara shi ba.', signIn: 'Shiga', view: 'Duba',
      inStock: 'Akwai', lowStock: 'Kaɗan ne suka rage', outStock: 'Babu', addQ: 'In ƙara shi zuwa kwando?',
      sendTicketQ: 'In aika wannan zuwa ga tallafi?', ticketSent: 'An aika zuwa ga tallafi', ticketNothing: 'Ban aika komai ba.',
      submitTicket: 'Aika zuwa ga tallafi', sending: 'Ana aikawa\u2026', cancel: 'Soke', ref: 'Lambar tunani',
      cancelledMsg: 'To, ban aika komai zuwa ga tallafi ba.',
      genericErr: 'Wani abu ya faru. Don Allah sake gwadawa.', timeoutErr: 'Ya ɗauki lokaci mai tsawo. Don Allah sake gwadawa.',
      connErr: 'Ban iya isa ga MAC ba. Duba hanyar sadarwar ka sannan sake gwadawa.',
      ticketFail: 'Ba mu iya aika shi ba. Don Allah sake gwadawa.', noConn: 'Babu hanyar sadarwa. Don Allah sake gwadawa.',
      chips: ['Nemo min abu ƙasa da \u20a650,000', 'Nuna min sabbin kaya', 'Taimaka min zaɓar kyauta', 'Kwatanta kaya biyu', 'Ina bukatar taimako da oda ta']
    }
  };
  function t(lang, key) { var d = STR[lang] || STR.en; return d[key] !== undefined ? d[key] : STR.en[key]; }

  var COLOR_LABEL = {
    default: { en: 'Default red', pcm: 'Default red', yo: 'Pupa àdánidá', ig: 'Uhie izugbe', ha: 'Ja na asali' },
    yellow: { en: 'Yellow', pcm: 'Yellow', yo: 'Ofeefee', ig: 'Odo odo', ha: 'Rawaya' },
    green: { en: 'Green', pcm: 'Green', yo: 'Àwọ̀ ewé', ig: 'Ndo ndo', ha: 'Kore' },
    blue: { en: 'Blue', pcm: 'Blue', yo: 'Búlúù', ig: 'Blu', ha: 'Shuɗi' },
    purple: { en: 'Purple', pcm: 'Purple', yo: 'Àwọ̀ èlùbọ́', ig: 'Odo uhie', ha: 'Shunayya' },
    pink: { en: 'Pink', pcm: 'Pink', yo: 'Pínkì', ig: 'Pink', ha: 'Ruwan hoda' },
    pride: { en: 'Pride', pcm: 'Pride', yo: 'Pride', ig: 'Pride', ha: 'Pride' }
  };

  var AVAIL_KEY = { in_stock: 'inStock', low_stock: 'lowStock', out_of_stock: 'outStock' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /* everything is escaped first, then only **bold**, "- " bullets and blank-line paragraphs are re-added — no raw HTML from the model ever reaches the page */
  function renderText(text) {
    var lines = esc(text).split(/\r?\n/), html = '', list = false;
    lines.forEach(function (ln) {
      var m = /^\s*(?:[-*\u2022])\s+(.*)$/.exec(ln), body = function (t2) { return t2.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); };
      if (m) { if (!list) { html += '<ul>'; list = true; } html += '<li>' + body(m[1]) + '</li>'; }
      else { if (list) { html += '</ul>'; list = false; } if (ln.trim()) html += '<p>' + body(ln) + '</p>'; }
    });
    return html + (list ? '</ul>' : '');
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    [].concat(kids == null ? [] : kids).forEach(function (c) { if (c !== '' && c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var store = {
    get: function (s, k) { try { return JSON.parse(s.getItem(k)); } catch (e) { return null; } },
    set: function (s, k, v) { try { s.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode / full */ } }
  };
  var reduced = function () { return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; };

  var ICON_SEND = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  var ICON_NEW = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  var ICON_X = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
  var ICON_CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  /* the settings gear, as supplied */
  var ICON_SETTINGS = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M14.2788 2.15224C13.9085 2 13.439 2 12.5 2C11.561 2 11.0915 2 10.7212 2.15224C10.2274 2.35523 9.83509 2.74458 9.63056 3.23463C9.53719 3.45834 9.50065 3.7185 9.48635 4.09799C9.46534 4.65568 9.17716 5.17189 8.69017 5.45093C8.20318 5.72996 7.60864 5.71954 7.11149 5.45876C6.77318 5.2813 6.52789 5.18262 6.28599 5.15102C5.75609 5.08178 5.22018 5.22429 4.79616 5.5472C4.47814 5.78938 4.24339 6.1929 3.7739 6.99993C3.30441 7.80697 3.06967 8.21048 3.01735 8.60491C2.94758 9.1308 3.09118 9.66266 3.41655 10.0835C3.56506 10.2756 3.77377 10.437 4.0977 10.639C4.57391 10.936 4.88032 11.4419 4.88029 12C4.88026 12.5581 4.57386 13.0639 4.0977 13.3608C3.77372 13.5629 3.56497 13.7244 3.41645 13.9165C3.09108 14.3373 2.94749 14.8691 3.01725 15.395C3.06957 15.7894 3.30432 16.193 3.7738 17C4.24329 17.807 4.47804 18.2106 4.79606 18.4527C5.22008 18.7756 5.75599 18.9181 6.28589 18.8489C6.52778 18.8173 6.77305 18.7186 7.11133 18.5412C7.60852 18.2804 8.2031 18.27 8.69012 18.549C9.17714 18.8281 9.46533 19.3443 9.48635 19.9021C9.50065 20.2815 9.53719 20.5417 9.63056 20.7654C9.83509 21.2554 10.2274 21.6448 10.7212 21.8478C11.0915 22 11.561 22 12.5 22C13.439 22 13.9085 22 14.2788 21.8478C14.7726 21.6448 15.1649 21.2554 15.3694 20.7654C15.4628 20.5417 15.4994 20.2815 15.5137 19.902C15.5347 19.3443 15.8228 18.8281 16.3098 18.549C16.7968 18.2699 17.3914 18.2804 17.8886 18.5412C18.2269 18.7186 18.4721 18.8172 18.714 18.8488C19.2439 18.9181 19.7798 18.7756 20.2038 18.4527C20.5219 18.2105 20.7566 17.807 21.2261 16.9999C21.6956 16.1929 21.9303 15.7894 21.9827 15.395C22.0524 14.8691 21.9088 14.3372 21.5835 13.9164C21.4349 13.7243 21.2262 13.5628 20.9022 13.3608C20.4261 13.0639 20.1197 12.558 20.1197 11.9999C20.1197 11.4418 20.4261 10.9361 20.9022 10.6392C21.2263 10.4371 21.435 10.2757 21.5836 10.0835C21.9089 9.66273 22.0525 9.13087 21.9828 8.60497C21.9304 8.21055 21.6957 7.80703 21.2262 7C20.7567 6.19297 20.522 5.78945 20.2039 5.54727C19.7799 5.22436 19.244 5.08185 18.7141 5.15109C18.4722 5.18269 18.2269 5.28136 17.8887 5.4588C17.3915 5.71959 16.7969 5.73002 16.3099 5.45096C15.8229 5.17191 15.5347 4.65566 15.5136 4.09794C15.4993 3.71848 15.4628 3.45833 15.3694 3.23463C15.1649 2.74458 14.7726 2.35523 14.2788 2.15224ZM12.5 15C14.1695 15 15.5228 13.6569 15.5228 12C15.5228 10.3431 14.1695 9 12.5 9C10.8305 9 9.47716 10.3431 9.47716 12C9.47716 13.6569 10.8305 15 12.5 15Z" fill="currentColor"></path></svg>';
  /* MAC's little face in the header. Every 6 s it looks left, looks right, then nods and puts its sunglasses on;
     a quick shake takes them off again. (Animated by mac-chat.css; tap it to replay the routine.) */
  var AVATAR = '<svg class="play" viewBox="0 0 40 40" aria-hidden="true"><circle class="mcInk" cx="20" cy="20" r="20"/>' +
    '<g class="mcFace"><rect class="mcPaper" x="8" y="14" width="24" height="13" rx="6.5"/>' +
    '<circle class="mcInk" cx="15" cy="20.5" r="3"/><circle class="mcInk" cx="25" cy="20.5" r="3"/></g>' +
    '<g class="mcGlasses"><rect class="mcInk" x="6.5" y="16" width="3" height="2" rx="1"/><rect class="mcInk" x="30.5" y="16" width="3" height="2" rx="1"/>' +
    '<rect class="mcInk" x="18.5" y="16" width="3" height="2.4"/>' +
    '<path class="mcInk" d="M8.6 15.4h10.4v5.2c0 3.2-2.2 5.2-5 5.2h-.6c-3 0-4.8-2-4.8-5.2z"/><path class="mcInk" d="M31.4 15.4H21v5.2c0 3.2 2.2 5.2 5 5.2h.6c3 0 4.8-2 4.8-5.2z"/>' +
    '<path class="mcGlint" d="M13.2 17.6l-2.2 5M16.8 17.6l-1 2.2M26.8 17.6l-2.2 5M30.4 17.6l-1 2.2"/></g></svg>';

  function MacChat(opts) {
    var o = this.o = {
      endpoint: '/api/assistant', ticketEndpoint: '/api/assistant-ticket',
      getSession: function () { return null; }, getStoreName: function () { return 'the store'; },
      fmt: function (n) { return '\u20A6' + Number(n).toLocaleString('en-NG'); }, currency: '\u20A6',
      onNavigate: function (fn) { fn(); },
      openProduct: null, openOrder: null, openSignIn: null, addToCart: null,
      mac: null, bindTap: true, maxLen: 1000, parent: document.body
    };
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];

    var saved = store.get(sessionStorage, SESSION_KEY) || {};
    this.msgs = Array.isArray(saved.msgs) ? saved.msgs : [];
    this.state = saved.state || {};
    this.lang = saved.lang || store.get(localStorage, LANG_KEY) || 'en';
    this.locked = !!saved.locked || !!store.get(localStorage, LANG_KEY);
    this.busy = false; this.isOpen = false; this.settingsOpen = false;

    this._build();
    this._bind();
  }
  var P = MacChat.prototype;

  P._mac = function () { return this.o.mac || Pcx.mac || null; };
  P._t = function (key) { return t(this.lang, key); };
  P._save = function () { store.set(sessionStorage, SESSION_KEY, { msgs: this.msgs.slice(-40), state: this.state, lang: this.lang, locked: this.locked }); };

  /* ---------- build / bind ---------- */
  P._build = function () {
    var self = this;
    var root = this.root = el('div', { class: 'macChat', hidden: '' });
    root.appendChild(el('div', { class: 'macChat-scrim', 'data-act': 'close' }));

    this.log = el('div', { class: 'macChat-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' });
    this.input = el('textarea', { class: 'macChat-input', rows: '1', maxlength: String(this.o.maxLen), enterkeyhint: 'send' });
    this.sendBtn = el('button', { class: 'macChat-send', type: 'submit', html: ICON_SEND, disabled: '' });
    this.form = el('form', { class: 'macChat-form', autocomplete: 'off' }, [this.input, this.sendBtn]);
    this.note = el('p', { class: 'macChat-note' });

    /* the one and only header: MAC's face, the store name, then reload / settings / close — in that order, and nothing else */
    this.avatarBtn = el('span', { class: 'macChat-avatar', role: 'button', tabindex: '0', html: AVATAR });
    this.titleB = el('b', {}, [this.o.getStoreName() + ' \u00b7 MAC']);
    this.titleSmall = el('small', {});
    this.newBtn = el('button', { class: 'macChat-ib', type: 'button', 'data-act': 'new', html: ICON_NEW });
    this.settingsBtn = el('button', { class: 'macChat-ib', type: 'button', 'data-act': 'settings', html: ICON_SETTINGS });
    this.closeBtn = el('button', { class: 'macChat-ib', type: 'button', 'data-act': 'close', html: ICON_X });
    this.head = el('header', { class: 'macChat-head' }, [
      this.avatarBtn, el('span', { class: 'macChat-title' }, [this.titleB, this.titleSmall]), this.newBtn, this.settingsBtn, this.closeBtn
    ]);

    /* Settings is a separate, self-contained overlay — its own header (back / title / close) and body — that
       covers the chat header, log and composer entirely while open. See the .macChat-settings CSS for why this
       is one absolutely-positioned block rather than several [hidden] toggles on the chat's own pieces. */
    this.backBtn = el('button', { class: 'macChat-ib', type: 'button', 'data-act': 'back', html: ICON_BACK });
    this.settingsTitleEl = el('b', {});
    this.settingsCloseBtn = el('button', { class: 'macChat-ib', type: 'button', 'data-act': 'close', html: ICON_X });
    this.settingsBody = el('div', { class: 'macChat-settings-body' });
    this.settingsPanel = el('div', { class: 'macChat-settings' }, [
      el('div', { class: 'macChat-settings-head' }, [this.backBtn, this.settingsTitleEl, this.settingsCloseBtn]),
      this.settingsBody
    ]);

    this.panel = el('section', { class: 'macChat-panel', role: 'dialog', 'aria-modal': 'true' }, [
      this.head, this.log, this.form, this.note, this.settingsPanel
    ]);
    root.appendChild(this.panel);
    this.o.parent.appendChild(root);
    this._applyStrings();
  };

  /* labels/placeholders/aria text for the current language — called on build and whenever the language changes */
  P._applyStrings = function () {
    this.panel.setAttribute('aria-label', this._t('dialogLabel'));
    this.titleSmall.textContent = this._t('subtitle');
    this.input.placeholder = this._t('placeholder');
    this.input.setAttribute('aria-label', this._t('inputLabel'));
    this.sendBtn.setAttribute('aria-label', this._t('send'));
    this.avatarBtn.setAttribute('aria-label', this._t('replay'));
    this.newBtn.setAttribute('aria-label', this._t('newChat'));
    this.settingsBtn.setAttribute('aria-label', this._t('settingsBtn'));
    this.closeBtn.setAttribute('aria-label', this._t('closeChat'));
    this.settingsCloseBtn.setAttribute('aria-label', this._t('closeChat'));
    this.backBtn.setAttribute('aria-label', this._t('backBtn'));
    this.settingsTitleEl.textContent = this._t('settingsTitle');
    this.note.textContent = this._t('disclaimer');
  };

  P._bind = function () {
    var self = this;

    this.root.addEventListener('click', function (e) {
      var t2 = e.target.closest('[data-act]');
      if (t2) {
        var act = t2.getAttribute('data-act');
        if (act === 'close') self.close();
        else if (act === 'new') self._resetTap();
        else if (act === 'settings') self._openSettings();
        else if (act === 'back') self._closeSettings();
        return;
      }
      if (e.target.closest('.macChat-avatar')) { self._replayAvatar(); return; }
      var chip = e.target.closest('.macChat-chip');
      if (chip) { self.ask(chip.textContent); return; }
      var retry = e.target.closest('.macChat-retry');
      if (retry) { self._retry(); return; }
      var langBtn = e.target.closest('.macSet-lang');
      if (langBtn) { self._chooseLanguage(langBtn.getAttribute('data-lang')); return; }
      var swatch = e.target.closest('.macSet-swatch');
      if (swatch) { self._chooseColor(swatch.getAttribute('data-color')); return; }
    });
    this.avatarBtn.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self._replayAvatar(); } });

    this.form.addEventListener('submit', function (e) { e.preventDefault(); self.ask(self.input.value); });
    this.input.addEventListener('input', function () {
      self.input.style.height = 'auto'; self.input.style.height = Math.min(self.input.scrollHeight, 120) + 'px';
      self.sendBtn.disabled = self.busy || !self.input.value.trim();
    });
    this.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); self.form.requestSubmit ? self.form.requestSubmit() : self.ask(self.input.value); }
    });

    this.root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); if (self.settingsOpen) self._closeSettings(); else self.close(); return; }
      if (e.key === 'Tab') {
        var f = self.panel.querySelectorAll('button:not([disabled]), select, textarea, [tabindex]');
        var visible = [].filter.call(f, function (n) { return n.offsetParent !== null || n === document.activeElement; });
        if (!visible.length) return;
        var first = visible[0], last = visible[visible.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    if (this.o.bindTap) { this._onTap = function (e) { e.preventDefault(); self.open(); }; global.addEventListener('mac:tap', this._onTap); }

    var vv = global.visualViewport;
    this._onVV = function () {
      if (!self.isOpen) return;
      if (global.innerWidth >= 720 || !vv) { self.panel.style.bottom = ''; self.panel.style.maxHeight = ''; return; }
      self.panel.style.bottom = Math.max(0, global.innerHeight - vv.height - vv.offsetTop) + 'px';
      self.panel.style.maxHeight = Math.round(vv.height * 0.94) + 'px';
    };
    if (vv) { vv.addEventListener('resize', this._onVV); vv.addEventListener('scroll', this._onVV); }
    global.addEventListener('resize', this._onVV);
  };

  P._replayAvatar = function () { var sv = this.root.querySelector('.macChat-avatar svg'); sv.classList.remove('play'); void sv.getBoundingClientRect(); sv.classList.add('play'); };

  /* ---------- settings screen ----------
     A single class flip (.settingsOpen on .macChat-panel) shows the overlay; the underlying header/log/form/note
     are also marked inert so a screen reader or Tab key can't reach content that's visually covered. */
  P._openSettings = function () {
    this.settingsOpen = true;
    this.panel.classList.add('settingsOpen');
    this.head.setAttribute('inert', ''); this.log.setAttribute('inert', ''); this.form.setAttribute('inert', ''); this.note.setAttribute('inert', '');
    this._renderSettings();
    this.backBtn.focus();
  };
  P._closeSettings = function () {
    this.settingsOpen = false;
    this.panel.classList.remove('settingsOpen');
    this.head.removeAttribute('inert'); this.log.removeAttribute('inert'); this.form.removeAttribute('inert'); this.note.removeAttribute('inert');
    this.settingsBtn.focus();
  };
  P._chooseLanguage = function (code) {
    if (!code || code === this.lang) return;
    this.lang = code; this.locked = true;
    store.set(localStorage, LANG_KEY, code);
    this._save(); this._applyStrings(); this._renderAll(); this._renderSettings();
  };
  P._chooseColor = function (id) {
    if (!Pcx.macTheme) return;
    Pcx.macTheme.set(id);
    this._renderSettings();
  };
  P._renderSettings = function () {
    var self = this, box = this.settingsBody;
    box.textContent = '';

    var langSec = el('div', { class: 'macSet-section' }, [el('h3', { class: 'macSet-h' }, [this._t('langLabel')])]);
    var langList = el('div', { class: 'macSet-langs' });
    LANGS.forEach(function (l) {
      var on = l[0] === self.lang;
      langList.appendChild(el('button', { class: 'macSet-lang' + (on ? ' on' : ''), type: 'button', 'data-lang': l[0], 'aria-pressed': on ? 'true' : 'false' },
        [el('span', {}, [l[1]]), on ? el('span', { html: ICON_CHECK }) : '']));
    });
    langSec.appendChild(langList);
    box.appendChild(langSec);

    if (Pcx.macTheme) {
      var current = Pcx.macTheme.get();
      var colSec = el('div', { class: 'macSet-section' }, [el('h3', { class: 'macSet-h' }, [this._t('colorLabel')])]);
      var swatches = el('div', { class: 'macSet-colors' });
      Pcx.macTheme.PRESETS.forEach(function (p) {
        var on = p.id === current;
        var label = (COLOR_LABEL[p.id] && (COLOR_LABEL[p.id][self.lang] || COLOR_LABEL[p.id].en)) || p.id;
        var attrs = { class: 'macSet-swatch' + (p.pride ? ' pride' : p.hex ? '' : ' default') + (on ? ' on' : ''), type: 'button', 'data-color': p.id, 'aria-label': label, 'aria-pressed': on ? 'true' : 'false' };
        if (p.hex) attrs.style = '--sw-color:' + p.hex;
        swatches.appendChild(el('button', attrs, [on ? el('span', { html: ICON_CHECK }) : '']));
      });
      colSec.appendChild(swatches);
      box.appendChild(colSec);
    }
  };

  /* ---------- open / close ---------- */
  P.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;
    this._returnFocus = document.activeElement;
    var mac = this._mac();
    this.root.classList.toggle('isLeft', !!(mac && mac.side === 'left'));
    this.root.classList.toggle('isRight', !(mac && mac.side === 'left'));
    this._renderAll();
    this.root.hidden = false;
    this._locked = global.innerWidth < 720;
    if (this._locked) { this._prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    var self = this;
    requestAnimationFrame(function () { self.root.classList.add('on'); self._onVV(); if (!self.settingsOpen) self.input.focus({ preventScroll: true }); });
  };

  P.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.settingsOpen) this._closeSettings();
    var self = this;
    this.root.classList.remove('on');
    if (this._locked) document.body.style.overflow = this._prevOverflow || '';
    setTimeout(function () { if (!self.isOpen) self.root.hidden = true; }, reduced() ? 0 : 260);
    var mac = this._mac();
    if (mac && this._returnFocus === mac.el) mac.el.focus({ preventScroll: true });
  };
  P.toggle = function () { this.isOpen ? this.close() : this.open(); };

  P._resetTap = function () {
    var self = this;
    if (!this.msgs.length) return;
    var btn = this.newBtn;
    if (!this._confirmReset) {
      this._confirmReset = true; btn.setAttribute('aria-label', this._t('confirmClear')); btn.classList.add('warn');
      setTimeout(function () { self._confirmReset = false; btn.setAttribute('aria-label', self._t('newChat')); btn.classList.remove('warn'); }, 3500);
      return;
    }
    this._confirmReset = false; btn.classList.remove('warn'); btn.setAttribute('aria-label', this._t('newChat'));
    this.reset();
  };
  P.reset = function () {
    this.msgs = []; this.state = { language: this.lang }; this.busy = false;
    this._save(); this._renderAll();
    this.input.value = ''; this.input.style.height = 'auto'; this.sendBtn.disabled = true;
    if (!this.settingsOpen) this.input.focus({ preventScroll: true });
  };

  /* ---------- rendering ---------- */
  P._toBottom = function (instant) {
    var l = this.log;
    if (instant || reduced()) l.scrollTop = l.scrollHeight; else l.scrollTo({ top: l.scrollHeight, behavior: 'smooth' });
  };
  P._sync = function () { this.sendBtn.disabled = this.busy || !this.input.value.trim(); this.log.setAttribute('aria-busy', this.busy ? 'true' : 'false'); };

  P._renderAll = function () {
    var self = this, box = this.log;
    box.textContent = '';
    if (!this.msgs.length) {
      var g = GREET[this.lang] || GREET.en;
      box.appendChild(el('div', { class: 'macChat-empty' }, [
        el('h2', {}, [g[0]]), el('p', {}, [g[1]]),
        el('div', { class: 'macChat-chips' }, t(this.lang, 'chips').map(function (c) { return el('button', { class: 'macChat-chip', type: 'button' }, [c]); }))
      ]));
    } else {
      this.msgs.forEach(function (m, i) { box.appendChild(self._msgNode(m, i)); });
      if (this.busy) box.appendChild(el('div', { class: 'macChat-msg bot macChat-typing', role: 'status', 'aria-label': this._t('dialogLabel') }, [el('span'), el('span'), el('span')]));
    }
    this._sync(); this._toBottom(true);
  };

  P._msgNode = function (m, idx) {
    var self = this, wrap = el('div', { class: 'macChat-turn ' + (m.role === 'user' ? 'me' : 'bot') });
    if (m.content) wrap.appendChild(el('div', { class: 'macChat-msg ' + (m.role === 'user' ? 'me' : 'bot') + (m.error ? ' err' : ''), html: m.role === 'user' ? '<p>' + esc(m.content) + '</p>' : renderText(m.content) }));
    if (m.error) wrap.appendChild(el('button', { class: 'macChat-retry', type: 'button' }, [this._t('tryAgain')]));
    var kids = [];
    (m.cards || []).forEach(function (c) { var n = self._card(c); if (n) kids.push(n); });
    (m.actions || []).forEach(function (a, ai) { var n = self._action(m, a, ai); if (n) kids.push(n); });
    if (m.ticket) kids.push(self._ticket(m, idx));
    if (kids.length) wrap.appendChild(el('div', { class: 'macChat-extras' }, kids));
    return wrap;
  };

  P._availText = function (code) { return this._t(AVAIL_KEY[code] || 'outStock'); };

  P._card = function (c) {
    var self = this;
    if (c.kind === 'product') {
      var img = c.image ? el('img', { src: c.image, alt: c.name, loading: 'lazy' }) : el('div', { class: 'mcPh', 'aria-hidden': 'true' }, [(c.name || '?').charAt(0).toUpperCase()]);
      var btns = [el('button', { class: 'mcBtn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(c.id); }); } }, [this._t('viewProduct')])];
      if (c.availability !== 'out_of_stock' && this.o.addToCart) {
        var add = el('button', { class: 'mcBtn', type: 'button', onclick: function () { self.o.addToCart(c.id, 1); add.textContent = self._t('added'); add.disabled = true; setTimeout(function () { add.textContent = self._t('addToCart'); add.disabled = false; }, 2200); } }, [this._t('addToCart')]);
        btns.push(add);
      }
      var price = el('div', { class: 'mcPp' }, [this.o.fmt(c.price)]);
      if (c.originalPrice && c.originalPrice > c.price) price.appendChild(el('s', {}, [this.o.fmt(c.originalPrice)]));
      return el('div', { class: 'mcPc' }, [img, el('div', { class: 'mcPi' }, [el('div', { class: 'mcPn' }, [c.name]), price, el('div', { class: 'mcPa ' + c.availability }, [this._availText(c.availability)]), c.reason ? el('div', { class: 'mcPr' }, [c.reason]) : '', el('div', { class: 'mcBtns' }, btns)])]);
    }
    if (c.kind === 'compare') {
      var head = el('tr', {}, [el('th', {}, [''])].concat(c.products.map(function (p) {
        return el('th', {}, [el('div', {}, [p.name]), el('div', { class: 'mcPp' }, [self.o.fmt(p.price)]), el('div', { class: 'mcPa ' + p.availability }, [self._availText(p.availability)]),
          el('button', { class: 'mcBtn', type: 'button', style: 'margin-top:5px', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(p.id); }); } }, [self._t('view')])]);
      })));
      var body = (c.rows || []).map(function (r) { return el('tr', {}, [el('td', {}, [r.label])].concat(r.values.map(function (v) { return el('td', {}, [v || '\u2014']); }))); });
      return el('div', { class: 'mcCmp', role: 'region', tabindex: '0' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])]);
    }
    if (c.kind === 'orders') {
      return el('div', { class: 'macChat-extras' }, (c.orders || []).map(function (o) {
        return el('button', { class: 'mcOrd', type: 'button', onclick: function () { if (o.id) self.o.onNavigate(function () { self.o.openOrder(o.id); }); } },
          [el('span', {}, [el('b', {}, ['#' + o.orderNumber]), el('small', {}, [(o.placedAt ? new Date(o.placedAt).toLocaleDateString() : '') + ' \u00b7 ' + self.o.fmt(o.total)])]), el('span', { class: 'mcPa in_stock' }, [String(o.delivery || '').replace(/_/g, ' ')])]);
      }));
    }
    return null;
  };

  P._action = function (m, a, ai) {
    var self = this, key = 'a' + ai;
    if (a.type === 'open_product') return el('button', { class: 'mcBtn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openProduct(a.id); }); } }, [this._t('open') + ' ' + a.name]);
    if (a.type === 'sign_in') return el('button', { class: 'mcBtn pri', type: 'button', onclick: function () { self.o.onNavigate(function () { self.o.openSignIn(); }); } }, [this._t('signIn')]);
    if (a.type === 'add_to_cart') {
      var done = m.done && m.done[key];
      if (done) return el('div', { class: 'mcBox' }, [done === 'added' ? this._t('addedMsg') : this._t('notAddedMsg')]);
      return el('div', { class: 'mcBox' }, [el('h4', {}, [this._t('addQ')]), el('div', {}, [a.quantity + ' \u00d7 ' + a.name + ' \u2014 ' + this.o.fmt(a.price * a.quantity)]),
        el('div', { class: 'mcBtns' }, [
          el('button', { class: 'mcBtn pri', type: 'button', onclick: function () { self.o.addToCart(a.id, a.quantity); self._mark(m, key, 'added'); } }, [this._t('addToCart')]),
          el('button', { class: 'mcBtn', type: 'button', onclick: function () { self._mark(m, key, 'no'); } }, [this._t('noThanks')])])]);
    }
    return null;
  };
  P._mark = function (m, key, v) { m.done = m.done || {}; m.done[key] = v; this._save(); this._renderAll(); };

  /* support ticket: nothing is sent until the shopper taps Submit; the server-signed token means it can't be edited here */
  P._ticket = function (m) {
    var self = this, t2 = m.ticket, p = t2.preview || {};
    var rows = [['Issue', String(p.category || '').replace(/_/g, ' ')], ['Order', p.orderNumber], ['Product', p.productName], ['Summary', p.summary], ['Name', p.name], ['Contact', [p.email, p.phone].filter(Boolean).join(' / ')]].filter(function (r) { return r[1]; });
    var dl = el('dl', {}); rows.forEach(function (r) { dl.appendChild(el('dt', {}, [r[0]])); dl.appendChild(el('dd', {}, [r[1]])); });
    if (t2.state === 'sent') return el('div', { class: 'mcBox' }, [el('h4', {}, [this._t('ticketSent')]), dl, el('div', {}, [this._t('ref') + ' #' + t2.id])]);
    if (t2.state === 'cancelled') return el('div', { class: 'mcBox' }, [this._t('ticketNothing')]);
    var send = el('button', { class: 'mcBtn pri', type: 'button', disabled: t2.state === 'sending' ? '' : null, onclick: function () { self._submitTicket(m); } }, [t2.state === 'sending' ? this._t('sending') : this._t('submitTicket')]);
    var cancel = el('button', { class: 'mcBtn', type: 'button', disabled: t2.state === 'sending' ? '' : null, onclick: function () {
      t2.state = 'cancelled'; self.msgs.push({ role: 'assistant', content: self._t('cancelledMsg') }); self._save(); self._renderAll();
    } }, [this._t('cancel')]);
    return el('div', { class: 'mcBox' }, [el('h4', {}, [this._t('sendTicketQ')]), dl, t2.error ? el('div', { style: 'color:var(--mac-accent);margin-top:6px' }, [t2.error]) : '', el('div', { class: 'mcBtns' }, [send, cancel])]);
  };
  P._submitTicket = function (m) {
    var self = this, t2 = m.ticket;
    if (t2.state === 'sending') return;
    t2.state = 'sending'; t2.error = ''; this._renderAll();
    var s = this.o.getSession(), headers = { 'Content-Type': 'application/json' };
    if (s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;
    fetch(this.o.ticketEndpoint, { method: 'POST', headers: headers, body: JSON.stringify({ token: t2.token }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok) { t2.state = 'sent'; t2.id = x.j.ticketId; self.msgs.push({ role: 'assistant', content: self._t('ticketSent') + '. ' + self._t('ref') + ' #' + x.j.ticketId + '.' }); }
        else { t2.state = 'error'; t2.error = x.j.error || self._t('ticketFail'); }
        self._save(); self._renderAll();
      }).catch(function () { t2.state = 'error'; t2.error = self._t('noConn'); self._save(); self._renderAll(); });
  };

  /* ---------- sending ---------- */
  P.ask = function (text) {
    text = String(text || '').trim().slice(0, this.o.maxLen);
    if (!text || this.busy) return;
    this.msgs.push({ role: 'user', content: text });
    this._save(); this._renderAll();
    this.input.value = ''; this.input.style.height = 'auto';
    this._ask();
  };

  P._ask = function () {
    var self = this, mac = this._mac();
    this.busy = true; this._renderAll();
    if (mac) mac.set('bounce', true);
    var s = this.o.getSession(), headers = { 'Content-Type': 'application/json' };
    if (s && s.access_token) headers.Authorization = 'Bearer ' + s.access_token;
    var history = this.msgs.filter(function (m) { return m.content && !m.error; }).slice(-14).map(function (m) { return { role: m.role, content: m.content.slice(0, 1500) }; });
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 40000);
    fetch(this.o.endpoint, { method: 'POST', headers: headers, signal: ctl ? ctl.signal : undefined, body: JSON.stringify({ messages: history, language: this.lang, languageLocked: this.locked, state: this.state, context: this.o.getContext ? this.o.getContext() : {} }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (x) {
        if (!x.ok) throw { user: x.j.error || self._t('genericErr') };
        var j = x.j;
        self.state = j.state || self.state;
        if (j.language && !self.locked && j.language !== self.lang) { self.lang = j.language; self._applyStrings(); }
        self.msgs.push({ role: 'assistant', content: j.reply, cards: j.cards || [], actions: j.actions || [], ticket: j.ticket ? { token: j.ticket.token, preview: j.ticket.preview, state: 'pending' } : null });
      })
      .catch(function (e) {
        var text = e && e.user ? e.user : (e && e.name === 'AbortError' ? self._t('timeoutErr') : self._t('connErr'));
        self.msgs.push({ role: 'assistant', content: text, error: true });
      })
      .then(function () {
        clearTimeout(timer); self.busy = false; self._save();
        if (mac) mac.set('bounce', false);
        if (self.isOpen) { self._renderAll(); if (!self.settingsOpen && global.innerWidth >= 720) self.input.focus({ preventScroll: true }); }
      });
  };

  P._retry = function () {
    if (this.busy) return;
    var last = this.msgs[this.msgs.length - 1];
    if (!last || !last.error) return;
    this.msgs.pop(); this._save(); this._renderAll(); this._ask();
  };

  P.destroy = function () {
    if (this._onTap) global.removeEventListener('mac:tap', this._onTap);
    global.removeEventListener('resize', this._onVV);
    if (this.isOpen && this._locked) document.body.style.overflow = this._prevOverflow || '';
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  Pcx.MacChat = MacChat;

  function auto() { if (!global.MAC_CHAT_MANUAL && !Pcx.macChat && !document.querySelector('.macChat')) Pcx.macChat = new MacChat(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})(window);
