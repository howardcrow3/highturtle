// Feedback intake: validation, access control and rate limiting. No AWS imports here, so the logic
// can be tested with in-memory stand-ins (see test/feedback.test.mjs). handler.mjs wires in DynamoDB/SSM.

import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export const APPS = ['backer', 'ceevee', 'golden', 'highturtle-site', 'turtlebox-site'];
export const CATEGORIES = ['feature', 'issue', 'praise', 'other'];

export const DEFAULT_ORIGINS = [
  'https://highturtle.com', 'https://www.highturtle.com',
  'https://highturtle.ai', 'https://www.highturtle.ai',
  'https://turtlebox.studio', 'https://www.turtlebox.studio',
];

export const LIMITS = {
  bodyBytes: 16 * 1024,
  message: 5000,
  short: 64, // appVersion, platform, locale
  email: 254,
  clockSkewSec: 300,
  perIpPerHour: 20,
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

const header = (event, name) => {
  const h = event.headers || {};
  return h[name] ?? h[name.toLowerCase()] ?? Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
};

export function signBody(key, timestamp, rawBody) {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(`${timestamp}.${rawBody}`).digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]+$/i.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// Practical address check: one @, no spaces or control characters, a dotted domain made of letters, digits and
// hyphens, and a top-level domain of 2+ letters. (Full RFC 5322 allows far more than any mailbox really uses.)
const EMAIL_RE = /^[^\s@"<>()\[\],;:\\\x00-\x1f\x7f]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export function isEmail(v) {
  if (typeof v !== 'string' || v.length > LIMITS.email) return false;
  const [local] = v.split('@');
  return EMAIL_RE.test(v) && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..');
}

const cleanShort = (v) => (typeof v === 'string' ? v.trim().slice(0, LIMITS.short) : undefined) || undefined;

// Returns { ok: true, item } or { ok: false, error }.
export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'body must be a JSON object' };
  const { app, rating, message, category, email, anonymous, appVersion, platform, locale } = input;
  if (!APPS.includes(app)) return { ok: false, error: `app must be one of ${APPS.join(', ')}` };
  if (rating !== undefined && rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    return { ok: false, error: 'rating must be a whole number from 1 to 5' };
  }
  if (message !== undefined && message !== null && typeof message !== 'string') return { ok: false, error: 'message must be text' };
  const text = (message || '').trim();
  if (text.length > LIMITS.message) return { ok: false, error: `message is longer than ${LIMITS.message} characters` };
  if (!text && (rating === undefined || rating === null)) return { ok: false, error: 'give a rating, a message, or both' };
  if (category !== undefined && category !== null && !CATEGORIES.includes(category)) {
    return { ok: false, error: `category must be one of ${CATEGORIES.join(', ')}` };
  }
  if (anonymous !== undefined && anonymous !== null && typeof anonymous !== 'boolean') return { ok: false, error: 'anonymous must be true or false' };
  // Anonymous wins: whatever arrives in email is dropped unchecked and never stored. Older app builds don't send the
  // flag, so a missing one means "not anonymous" and an email they send is kept as before.
  let contact;
  if (anonymous !== true && email !== undefined && email !== null && !(typeof email === 'string' && email.trim() === '')) {
    if (typeof email !== 'string' || !isEmail(email.trim())) return { ok: false, error: 'email is not a valid address' };
    contact = email.trim();
  }
  const item = {
    app,
    ...(Number.isInteger(rating) ? { rating } : {}),
    ...(text ? { message: text } : {}),
    category: category || (text ? 'other' : undefined),
    ...(contact ? { email: contact } : {}),
    appVersion: cleanShort(appVersion),
    platform: cleanShort(platform),
    locale: cleanShort(locale),
  };
  for (const k of Object.keys(item)) if (item[k] === undefined) delete item[k];
  return { ok: true, item };
}

// deps: { getAppKeys: async () => ({ backer: 'hex', ... }), store: { put(item), hit(key, ttlSec) -> count, claim(key, ttlSec) -> bool },
//         now: () => ms, newId: () => string, origins: string[] }
export function makeApp(deps) {
  const now = deps.now || (() => Date.now());
  const newId = deps.newId || (() => randomUUID());
  const origins = deps.origins || DEFAULT_ORIGINS;
  const perIp = deps.perIpPerHour ?? LIMITS.perIpPerHour;

  return async function handle(event) {
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const path = event.rawPath || event.path || '/';

    if (method === 'GET' && path.endsWith('/health')) return json(200, { ok: true });
    if (method !== 'POST' || !path.endsWith('/v1/feedback')) return json(404, { error: 'not found' });

    let raw = event.body || '';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    if (Buffer.byteLength(raw) > LIMITS.bodyBytes) return json(413, { error: 'request is too large' });

    // ---- Who is calling: a signed app, or one of our websites ----
    const sigApp = header(event, 'x-ht-app');
    const sig = header(event, 'x-ht-signature');
    const ts = header(event, 'x-ht-timestamp');
    let source;
    if (sigApp || sig || ts) {
      const keys = await deps.getAppKeys();
      const key = keys[sigApp];
      const tsNum = Number(ts);
      if (!key || !sig || !Number.isInteger(tsNum)) return json(401, { error: 'unknown app or missing signature' });
      if (Math.abs(now() / 1000 - tsNum) > LIMITS.clockSkewSec) return json(401, { error: 'timestamp is too far from server time' });
      if (!safeEqualHex(sig, signBody(key, ts, raw))) return json(401, { error: 'bad signature' });
      // A captured request can't be replayed: each signature is accepted once.
      if (!(await deps.store.claim(`sig#${sig}`, 2 * LIMITS.clockSkewSec))) return json(409, { error: 'duplicate request' });
      source = 'app';
    } else {
      const origin = header(event, 'origin');
      if (!origin || !origins.includes(origin)) return json(403, { error: 'origin not allowed' });
      source = 'web';
    }

    let input;
    try { input = JSON.parse(raw); } catch { return json(400, { error: 'body is not valid JSON' }); }
    // Honeypot: a hidden form field people never fill in. Pretend success so bots learn nothing.
    if (input && typeof input === 'object' && input.hp) return json(201, { id: newId(), createdAt: new Date(now()).toISOString() });

    const v = validate(input);
    if (!v.ok) return json(400, { error: v.error });
    if (source === 'app' && v.item.app !== sigApp) return json(403, { error: 'app does not match the signing key' });

    // ---- Per-IP rate limit (hashed IP, hourly bucket, expires on its own) ----
    const ip = event.requestContext?.http?.sourceIp || 'unknown';
    const hour = Math.floor(now() / 3_600_000);
    const ipHash = createHash('sha256').update(`feedback:${ip}`).digest('hex').slice(0, 32);
    const count = await deps.store.hit(`ip#${ipHash}#${hour}`, 2 * 3600);
    if (count > perIp) return json(429, { error: 'too many submissions, try again later' });

    const createdAt = new Date(now()).toISOString();
    const item = { id: newId(), createdAt, ...v.item, source, status: 'new' };
    await deps.store.put(item);
    return json(201, { id: item.id, createdAt });
  };
}
