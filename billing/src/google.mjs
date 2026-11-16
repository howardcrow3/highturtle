// Google sign-in (OpenID Connect, authorization code flow, server side).
// The ID token comes straight from Google's token endpoint over TLS in exchange for our client secret, so
// per OpenID Connect Core 3.1.3.7 its signature check can rely on that TLS channel. We still check the
// issuer, audience, expiry, nonce and that Google verified the email.

import { randomBytes } from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export const newNonce = () => randomBytes(16).toString('base64url');

export function authUrl({ clientId, redirectUri, state, nonce }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email', state, nonce, prompt: 'select_account',
  });
  return `${AUTH_URL}?${q}`;
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1];
  if (!part) throw new Error('malformed id_token');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// Returns the verified, lower-cased email, or throws.
export async function exchangeCode({ code, clientId, clientSecret, redirectUri, nonce, fetchImpl = fetch, now = Date.now() }) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const { id_token: idToken } = await res.json();
  const c = decodeJwtPayload(idToken);
  if (!ISSUERS.has(c.iss)) throw new Error('bad issuer');
  if (c.aud !== clientId) throw new Error('bad audience');
  if (!c.exp || c.exp * 1000 < now) throw new Error('expired');
  if (!nonce || c.nonce !== nonce) throw new Error('bad nonce');
  if (c.email_verified !== true && c.email_verified !== 'true') throw new Error('email not verified');
  if (!c.email) throw new Error('no email');
  return String(c.email).trim().toLowerCase();
}
