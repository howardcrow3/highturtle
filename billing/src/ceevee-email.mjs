// The CeeVee license email. Same design as the Golden email (golden-email.mjs): HTML in a table layout with inline
// styles, so it holds up in Gmail, Outlook and Apple Mail, plus a plain-text fallback. The button goes to an https
// page, because most mail clients refuse ceevee:// links; that page hands the key to the installed app. Each key is
// also shown in a block so it can be copied, and the app accepts it pasted on its License screen. One block per key
// when someone buys more than one. Palette and voice follow the Turtlebox design system (turtlebox/design-system).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const INK = '#1c1c1c', BODY = '#3a3530', PAPER = '#f5f0e7', CARD = '#fbf8f2', LINE = '#d9d2c5', GOLD = '#d4a853', ASH = '#8a8278';
const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const baseOf = (site) => String(site || 'https://turtlebox.studio').replace(/\/$/, '');

export function ceeveeActivationUrl(site, key) {
  return `${baseOf(site)}/ceevee/activate/#key=${key}`;
}

export function ceeveeEmail({ keys, site, seats = 2, order }) {
  const base = baseOf(site);
  const many = keys.length > 1;
  const subject = many ? 'Your CeeVee license keys' : 'Your CeeVee license key';
  const heading = 'Thanks for buying CeeVee';
  const lede = many
    ? 'Open each button below on the computer where CeeVee is installed. Every button activates one license in a single step.'
    : 'Open the button below on the computer where CeeVee is installed. It activates your license in one step.';
  const fallback = `If the button does not open CeeVee, go to Settings in the app, then License, paste the key and choose Activate.`;
  const keep = `${many ? 'Each key works' : 'Your key works'} on up to ${seats} computers and covers every 1.x update. You can free a seat any time at ${base}/ceevee/license. Keep this email: you can use the key again on a new computer.`;
  const download = `Not installed yet? Download CeeVee: ${base}/ceevee/`;
  const orderLine = `Order ${order} (receipt from Paddle, our Merchant of Record)`;

  const text = [
    heading, '',
    lede.replaceAll('button', 'link'), '',
    ...keys.flatMap((k, i) => [
      ...(many ? [`License ${i + 1} of ${keys.length}`] : []),
      `Activate CeeVee: ${ceeveeActivationUrl(site, k)}`, `Key: ${k}`, '',
    ]),
    fallback, '',
    keep, '', download,
    '', orderLine, 'Questions: reply to this email.', '', 'Turtlebox',
  ].join('\n');

  const keyBlock = (k, i) => `
    ${many ? `<p style="margin:0 0 8px 0;font-size:12px;line-height:1.4;letter-spacing:0.16em;text-transform:uppercase;color:${ASH};">License ${i + 1} of ${keys.length}</p>` : ''}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;"><tr>
      <td align="center" bgcolor="${GOLD}" style="background:${GOLD};"><a href="${esc(ceeveeActivationUrl(site, k))}" style="display:inline-block;padding:15px 32px;font-family:${SANS};font-size:13px;line-height:1;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:${INK};text-decoration:none;">Activate CeeVee</a></td>
    </tr></table>
    <div style="margin:0 0 ${i === keys.length - 1 ? 24 : 28}px 0;padding:12px 14px;background:${PAPER};border:1px solid ${LINE};font-family:${MONO};font-size:13px;line-height:1.5;color:${INK};word-break:break-all;overflow-wrap:anywhere;">${esc(k)}</div>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(lede)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td style="padding:0 0 20px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;"><img src="${base}/assets/icons/ceevee-144.png" width="48" height="48" alt="" style="display:block;border:0;border-radius:11px;"></td>
      <td style="vertical-align:middle;padding-left:14px;font-family:${SANS};font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:${INK};font-weight:500;">CeeVee</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:${CARD};border:1px solid ${LINE};padding:36px 32px;font-family:${SANS};color:${BODY};">
    <h1 style="margin:0 0 12px 0;font-family:${SANS};font-size:26px;line-height:1.2;font-weight:300;letter-spacing:-0.02em;color:${INK};">${esc(heading)}</h1>
    <p style="margin:0 0 28px 0;font-size:16px;line-height:1.6;color:${BODY};">${esc(lede)}</p>${keys.map(keyBlock).join('')}
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:${BODY};">${esc(fallback)}</p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:${BODY};">${esc(keep)}</p>
    <p style="margin:12px 0 0 0;font-size:14px;line-height:1.6;color:${BODY};">Not installed yet? <a href="${base}/ceevee/" style="color:${INK};">Download CeeVee</a>.</p>
  </td></tr>
  <tr><td style="padding:20px 4px 0 4px;font-family:${SANS};font-size:12px;line-height:1.6;color:${ASH};">
    ${esc(orderLine)}<br>Questions: reply to this email.<br><br>Turtlebox builds small AI apps. <a href="${base}/" style="color:${ASH};">turtlebox.studio</a>
  </td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
