// The Backer license email, built like the Golden one (golden-email.mjs): HTML with table layout and inline styles so it
// holds up in Gmail, Outlook and Apple Mail, plus a plain-text fallback. The button goes to an https page (most mail
// clients refuse backer:// links) that hands the key to the installed app. The key is also shown in a block so it can be
// copied, and the app accepts it pasted in Settings, License. Palette and voice follow the Turtlebox design system.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const INK = '#1c1c1c', BODY = '#3a3530', PAPER = '#f5f0e7', CARD = '#fbf8f2', LINE = '#d9d2c5', GOLD = '#d4a853', ASH = '#8a8278';
const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function activationUrl(site, key) {
  return `${String(site || 'https://turtlebox.studio').replace(/\/$/, '')}/backer/activate/#key=${key}`;
}

export function backerEmail({ keys, email, site, seats = 2, order }) {
  const base = String(site || 'https://turtlebox.studio').replace(/\/$/, '');
  const plural = keys.length > 1;
  const downloadUrl = `${base}/backer/`;
  const accountUrl = `${base}/account/`;
  const subject = plural ? 'Your Backer license keys' : 'Your Backer license key';
  const heading = 'Thanks for buying Backer';
  const lede = plural
    ? 'Open each button below on the computer where Backer is installed. It activates that key in one step.'
    : 'Open the button below on the computer where Backer is installed. It activates your license in one step.';
  const fallback = `If the button does not open Backer, open Backer, go to Settings, then License, paste ${plural ? 'a' : 'the'} key and click Activate.`;
  const details = `${plural ? 'Each key is' : 'The key is'} tied to ${email}, covers every 1.x update and works on up to ${seats} computers at once.`;
  const moving = `To move it to a new computer, choose Deactivate in Settings, License on the old one, or free a computer at ${accountUrl}.`;
  const orderLine = `Order ${order} (receipt from Paddle, our Merchant of Record)`;

  const text = [
    heading, '',
    lede.replace(/button(s?) below/, 'link$1 below').replace('each button', 'each link'), '',
    ...keys.flatMap((k, i) => [`${plural ? `Activate key ${i + 1}` : 'Activate Backer'}: ${activationUrl(site, k)}`, '']),
    fallback.replace('the button', 'the link'), '',
    ...keys.flatMap((k) => [k, '']),
    details, moving, '',
    `Download Backer: ${downloadUrl}`, '',
    orderLine, 'Questions: reply to this email.', '', 'Turtlebox',
  ].join('\n');

  const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;"><tr>
      <td align="center" bgcolor="${GOLD}" style="background:${GOLD};"><a href="${esc(href)}" style="display:inline-block;padding:15px 32px;font-family:${SANS};font-size:13px;line-height:1;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:${INK};text-decoration:none;">${esc(label)}</a></td>
    </tr></table>`;
  const buttons = keys.map((k, i) => button(activationUrl(site, k), plural ? `Activate key ${i + 1}` : 'Activate Backer')).join('\n    ');
  const keyBlocks = keys.map((k) => `<div style="margin:0 0 12px 0;padding:12px 14px;background:${PAPER};border:1px solid ${LINE};font-family:${MONO};font-size:12px;line-height:1.5;color:${INK};word-break:break-all;overflow-wrap:anywhere;">${esc(k)}</div>`).join('\n    ');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(lede)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td style="padding:0 0 20px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;"><img src="${base}/assets/icons/backer-144.png" width="48" height="48" alt="" style="display:block;border:0;border-radius:11px;"></td>
      <td style="vertical-align:middle;padding-left:14px;font-family:${SANS};font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:${INK};font-weight:500;">Backer</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${CARD};border:1px solid ${LINE};padding:36px 32px;font-family:${SANS};color:${BODY};">
    <h1 style="margin:0 0 12px 0;font-family:${SANS};font-size:26px;line-height:1.2;font-weight:300;letter-spacing:-0.02em;color:${INK};">${esc(heading)}</h1>
    <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:${BODY};">${esc(lede)}</p>
    ${buttons}
    <p style="margin:16px 0 8px 0;font-size:14px;line-height:1.6;color:${BODY};">${esc(fallback)}</p>
    ${keyBlocks}
    <p style="margin:12px 0 0 0;font-size:14px;line-height:1.6;color:${BODY};">Backer is not installed yet? <a href="${esc(downloadUrl)}" style="color:${BODY};">Download it here</a>.</p>
    <p style="margin:24px 0 0 0;font-size:14px;line-height:1.6;color:${BODY};">${esc(details)}</p>
    <p style="margin:12px 0 0 0;font-size:14px;line-height:1.6;color:${BODY};">To move it to a new computer, choose Deactivate in Settings, License on the old one, or <a href="${esc(accountUrl)}" style="color:${BODY};">free a computer on your account page</a>.</p>
  </td></tr>
  <tr><td style="padding:20px 4px 0 4px;font-family:${SANS};font-size:12px;line-height:1.6;color:${ASH};">
    ${esc(orderLine)}<br>Questions: reply to this email.<br><br>Turtlebox builds small AI apps. <a href="${base}/" style="color:${ASH};">turtlebox.studio</a>
  </td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
