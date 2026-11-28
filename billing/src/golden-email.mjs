// The Golden licence email: HTML (table layout, inline styles, so it holds up in Gmail, Outlook and Apple Mail) plus a
// plain-text fallback. The button goes to an https page, because most mail clients refuse golden:// links; that page
// hands the key to the installed app. The key is also shown in a block so it can be copied, and the app accepts it
// pasted on its Licence screen. Palette and voice follow the Turtlebox design system (turtlebox/design-system).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const INK = '#1c1c1c', BODY = '#3a3530', PAPER = '#f5f0e7', CARD = '#fbf8f2', LINE = '#d9d2c5', GOLD = '#d4a853', ASH = '#8a8278';
const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function activationUrl(site, token) {
  return `${String(site || 'https://turtlebox.studio').replace(/\/$/, '')}/golden/activate/#key=${token}`;
}

export function goldenEmail({ token, site, core, ownsApp = true, plaidUntil, order }) {
  const renewal = !core && !!plaidUntil;
  const url = activationUrl(site, token);
  const base = String(site || 'https://turtlebox.studio').replace(/\/$/, '');
  const subject = renewal ? 'Your Golden bank-connection licence is renewed' : 'Your Golden licence key';
  const heading = renewal ? 'Your bank-connection add-on is renewed' : 'Thanks for buying Golden';
  const lede = renewal
    ? `The add-on is paid through ${plaidUntil}. Open the button below on the computer where Golden is installed to apply the new key.`
    : 'Open the button below on the computer where Golden is installed. It activates your licence in one step.';
  const extra = !renewal && plaidUntil
    ? `Your bank-connection add-on, bought with Golden, is paid through ${plaidUntil}.`
    : renewal && !ownsApp
      ? 'This key turns on bank connections only. Golden itself needs its own licence: buy it from the Licence screen in the app.'
      : '';
  const orderLine = `Order ${order} (receipt from Paddle, our Merchant of Record)`;
  const keep = 'It works offline and covers every 1.x update. Keep this email: you can use the key again on a new computer.';

  const text = [
    heading, '',
    lede.replace('the button below', 'the link below'), '',
    `Activate Golden: ${url}`, '',
    'If the link does not open Golden, open Golden, go to the Licence screen, paste this key and choose Activate:', '',
    token, '',
    keep,
    ...(extra ? ['', extra] : []),
    '', orderLine, 'Questions: reply to this email.', '', 'Turtlebox',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(lede)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td style="padding:0 0 20px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;"><img src="${base}/assets/icons/golden-144.png" width="48" height="48" alt="" style="display:block;border:0;border-radius:11px;"></td>
      <td style="vertical-align:middle;padding-left:14px;font-family:${SANS};font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:${INK};font-weight:500;">Golden</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${CARD};border:1px solid ${LINE};padding:36px 32px;font-family:${SANS};color:${BODY};">
    <h1 style="margin:0 0 12px 0;font-family:${SANS};font-size:26px;line-height:1.2;font-weight:300;letter-spacing:-0.02em;color:${INK};">${esc(heading)}</h1>
    <p style="margin:0 0 28px 0;font-size:16px;line-height:1.6;color:${BODY};">${esc(lede)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;"><tr>
      <td align="center" bgcolor="${GOLD}" style="background:${GOLD};"><a href="${esc(url)}" style="display:inline-block;padding:15px 32px;font-family:${SANS};font-size:13px;line-height:1;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:${INK};text-decoration:none;">Activate Golden</a></td>
    </tr></table>
    <p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:${BODY};">If the button does not open Golden, open Golden, go to the Licence screen, paste this key and choose Activate.</p>
    <div style="margin:0 0 24px 0;padding:12px 14px;background:${PAPER};border:1px solid ${LINE};font-family:${MONO};font-size:12px;line-height:1.5;color:${INK};word-break:break-all;overflow-wrap:anywhere;">${esc(token)}</div>
    <p style="margin:0;font-size:14px;line-height:1.6;color:${BODY};">${esc(keep)}</p>
    ${extra ? `<p style="margin:12px 0 0 0;font-size:14px;line-height:1.6;color:${BODY};">${esc(extra)}</p>` : ''}
  </td></tr>
  <tr><td style="padding:20px 4px 0 4px;font-family:${SANS};font-size:12px;line-height:1.6;color:${ASH};">
    ${esc(orderLine)}<br>Questions: reply to this email.<br><br>Turtlebox builds small AI apps. <a href="${base}/" style="color:${ASH};">turtlebox.studio</a>
  </td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
