// Feedback client for High Turtle apps and websites. No dependencies; works in browsers, Tauri webviews
// and Node 18+ (uses fetch and Web Crypto).
//
// Website (no key; the page's origin must be one of our domains):
//   await sendFeedback({ app: 'turtlebox-site', rating: 5, message: 'Love it' });
//
// Desktop app (signed with the app's key, injected at build time, never committed):
//   await sendFeedback({ app: 'golden', rating: 4, message: '...', category: 'feature', appVersion: '1.3.0' },
//                      { key: import.meta.env.VITE_FEEDBACK_KEY });
//
// Resolves to { id, createdAt }. Throws an Error whose .status is the HTTP status (400 bad input,
// 429 too many submissions, others: try later).

export const FEEDBACK_URL = 'https://feedback.turtlebox.studio/v1/feedback';

async function hmacHex(keyHex, text) {
  const keyBytes = new Uint8Array(keyHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sendFeedback(feedback, { key, url = FEEDBACK_URL } = {}) {
  const body = JSON.stringify(feedback);
  const headers = { 'content-type': 'application/json' };
  if (key) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers['x-ht-app'] = feedback.app;
    headers['x-ht-timestamp'] = ts;
    headers['x-ht-signature'] = await hmacHex(key, `${ts}.${body}`);
  }
  const res = await fetch(url, { method: 'POST', headers, body });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(out.error || `feedback failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return out;
}
