// Shared building blocks for every Maccato/Marcato email. Nothing in here knows about a specific order event:
// templates.js combines these pieces, so the brand (logo, colours, footer) is defined once.
// Everything that comes from the database goes through esc(); emails are plain inline-styled tables for mail clients.

const BRAND = { color: '#D91C2D', ink: '#1a1a1a', muted: '#6b7280', line: '#e5e7eb', bg: '#f4f4f5', card: '#ffffff' };
const TONES = {
  info:    { bg: '#eef2ff', fg: '#3730a3' },
  success: { bg: '#dcfce7', fg: '#166534' },
  warning: { bg: '#fef3c7', fg: '#92400e' },
  danger:  { bg: '#fee2e2', fg: '#991b1b' }
};

const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur) => (cur || '₦') + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 });
const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');

function heading(text) {
  return `<h1 style="margin:0 0 8px;font:700 22px/1.3 Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(text)}</h1>`;
}
function paragraph(text, opts = {}) {
  return `<p style="margin:0 0 14px;font:${opts.small ? '13px/1.5' : '15px/1.6'} Arial,Helvetica,sans-serif;color:${opts.muted ? BRAND.muted : BRAND.ink}">${esc(text)}</p>`;
}
function badge(label, tone = 'info') {
  const t = TONES[tone] || TONES.info;
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${t.bg};color:${t.fg};font:700 12px Arial,Helvetica,sans-serif;letter-spacing:.3px">${esc(label)}</span>`;
}
function metaTable(rows) {
  const r = rows.filter(x => x && x[1]).map(([k, v]) =>
    `<tr><td style="padding:4px 12px 4px 0;font:13px Arial,Helvetica,sans-serif;color:${BRAND.muted};white-space:nowrap">${esc(k)}</td>` +
    `<td style="padding:4px 0;font:600 13px Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(v)}</td></tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${r}</table>`;
}
function itemsTable(groups, currency) {
  return groups.map(g => {
    const rows = g.items.map(i =>
      `<tr><td style="padding:8px 0;border-top:1px solid ${BRAND.line};font:14px Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(i.name)} <span style="color:${BRAND.muted}">× ${esc(i.qty)}</span></td>` +
      `<td align="right" style="padding:8px 0;border-top:1px solid ${BRAND.line};font:14px Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(money(i.price * i.qty, currency))}</td></tr>`).join('');
    return `<div style="margin:0 0 14px"><div style="font:700 13px Arial,Helvetica,sans-serif;color:${BRAND.ink};margin:0 0 4px">${esc(g.seller)}</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></div>`;
  }).join('');
}
function trackingCard(t) {
  if (!t || !(t.number || t.carrier)) return '';
  const line = (k, v) => v ? `<div style="font:13px Arial,Helvetica,sans-serif;color:${BRAND.muted};margin-top:6px">${esc(k)}<br><span style="font:700 15px Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(v)}</span></div>` : '';
  return `<div style="margin:0 0 18px;padding:14px 16px;border:1px solid ${BRAND.line};border-radius:10px;background:#fafafa">` +
    line('Tracking number', t.number) + line('Carrier', t.carrier) + line('Estimated delivery', t.eta) +
    (t.url ? `<div style="margin-top:10px"><a href="${esc(safeUrl(t.url))}" style="font:13px Arial,Helvetica,sans-serif;color:${BRAND.color}">Track with the carrier</a></div>` : '') + `</div>`;
}
function button(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr><td style="border-radius:8px;background:${BRAND.color}">` +
    `<a href="${esc(safeUrl(url))}" style="display:inline-block;padding:13px 28px;font:700 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">${esc(label)}</a></td></tr></table>`;
}

function layout({ store, logoUrl, preheader, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(store)}</title></head>` +
    `<body style="margin:0;padding:0;background:${BRAND.bg}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || '')}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${BRAND.card};border-radius:14px;overflow:hidden">` +
    `<tr><td style="padding:20px 28px;border-bottom:3px solid ${BRAND.color}"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    (logoUrl ? `<td style="padding-right:10px"><img src="${esc(safeUrl(logoUrl))}" alt="" width="36" height="36" style="display:block;border-radius:8px"></td>` : '') +
    `<td style="font:800 20px Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(store)}</td></tr></table></td></tr>` +
    `<tr><td style="padding:28px">${body}</td></tr>` +
    `<tr><td style="padding:18px 28px;background:#fafafa;font:12px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.muted}">${footer}</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

// plain-text twin of a message (some clients, and spam filters, like having one)
function toText(lines) { return lines.filter(Boolean).join('\n'); }

module.exports = { BRAND, esc, money, heading, paragraph, badge, metaTable, itemsTable, trackingCard, button, layout, toText };
