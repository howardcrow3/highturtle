// Feedback client for High Turtle apps and websites. No dependencies; for websites (uses fetch).
//
// Website (no key; the page's origin must be one of our domains):
//   await sendFeedback({ app: 'turtlebox-site', rating: 5, message: 'Love it', email: 'me@example.com' });
//   await sendFeedback({ app: 'turtlebox-site', rating: 5, message: 'Love it', anonymous: true }); // no email sent
//
// Desktop apps do not use this file: they sign with a per-install Ed25519 key (see README).
//
// Resolves to { id, createdAt }. Throws an Error whose .status is the HTTP status (400 bad input,
// 429 too many submissions, others: try later).

export const FEEDBACK_URL = 'https://feedback.turtlebox.studio/v1/feedback';

export async function sendFeedback(feedback, { url = FEEDBACK_URL } = {}) {
  // "Send anonymously": the email never leaves the device.
  if (feedback.anonymous) { feedback = { ...feedback }; delete feedback.email; }
  const body = JSON.stringify(feedback);
  const headers = { 'content-type': 'application/json' };
  const res = await fetch(url, { method: 'POST', headers, body });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(out.error || `feedback failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return out;
}
