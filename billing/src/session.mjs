// Signed, expiring tokens for email sign-in links and the session cookie.
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, purpose + "." + payload)).
// Stateless: nothing is stored, so there is nothing to clean up.

import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function mac(secret, purpose, body) {
  return createHmac('sha256', secret).update(`${purpose}.${body}`).digest();
}

export function signToken(secret, purpose, data, ttlSeconds, now = Date.now()) {
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const body = b64(JSON.stringify({ ...data, exp: Math.floor(now / 1000) + ttlSeconds }));
  return `${body}.${b64(mac(secret, purpose, body))}`;
}

export function verifyToken(secret, purpose, token, now = Date.now()) {
  if (!secret || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = mac(secret, purpose, body);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.exp || data.exp * 1000 < now) return null;
  return data;
}

export const LOGIN_TTL = 15 * 60;
export const SESSION_TTL = 7 * 24 * 3600;
export const COOKIE = 'tb_account';

export function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/api/billing; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(event, name = COOKIE) {
  const list = event.cookies || (event.headers?.cookie ? event.headers.cookie.split(/;\s*/) : []);
  for (const c of list) {
    const i = c.indexOf('=');
    if (i > 0 && c.slice(0, i).trim() === name) return c.slice(i + 1).trim();
  }
  return null;
}
