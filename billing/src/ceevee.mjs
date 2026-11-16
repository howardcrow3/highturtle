// CeeVee licensing: key generation, signed tokens and the key format the app expects.
// Matches howardcrow3/CeeVee crates/ceevee-license (token.rs, key.rs) and docs/LICENSE_API.md.
//
// Token: base64url(json) + "." + base64url(Ed25519 signature over those json bytes), no padding.
// Key:   CEEV-XXXXX-XXXXX-XXXXX-XXXXX, groups from 0-9A-Z without I L O U.
// The private seed lives only in Secrets Manager (CEEVEE_SIGNING_KEY); the app holds the public key.

import { createHmac } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));

export const SEED_RE = /^[0-9a-fA-F]{64}$/;

// What the app's key.rs normalize() accepts, so a key typed by hand still finds its row.
export function normalizeKey(input) {
  const flat = String(input ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!flat.startsWith('CEEV')) return null;
  const body = [...flat.slice(4)].map((c) => (c === 'O' ? '0' : c === 'I' || c === 'L' ? '1' : c)).join('');
  if (body.length !== 20 || ![...body].every((c) => ALPHABET.includes(c))) return null;
  return `CEEV-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15)}`;
}

// Deterministic per (transaction, unit): a Paddle retry after a half-finished delivery yields the
// same key, so a customer never ends up with two different keys for one purchase. Unguessable
// without the signing seed (100 bits of HMAC output).
export function deriveKey(seedHex, transactionId, index = 0) {
  if (!SEED_RE.test(seedHex.trim())) throw new Error('signing key must be 64 hex characters');
  const mac = createHmac('sha256', Buffer.from(seedHex.trim(), 'hex')).update(`ceevee-key|${transactionId}|${index}`).digest();
  let bits = 0, value = 0, out = '';
  for (const b of mac) {
    value = ((value << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5 && out.length < 20) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length === 20) break;
  }
  return `CEEV-${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15)}`;
}

async function importSeed(seedHex) {
  const seed = seedHex.trim();
  if (!SEED_RE.test(seed)) throw new Error('signing key must be 64 hex characters');
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...hex(seed)]);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
}

const isoSeconds = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function signClaims(seedHex, claims) {
  const key = await importSeed(seedHex);
  const payload = new TextEncoder().encode(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('Ed25519', key, payload);
  return `${b64url(payload)}.${b64url(new Uint8Array(sig))}`;
}

export const licenseClaims = ({ key, machine, issuedAt, major, seats }) =>
  ({ kind: 'license', key, machine, issued_at: isoSeconds(issuedAt), major, seats });

export const trialClaims = ({ machine, startedAt }) =>
  ({ kind: 'trial', machine, started_at: isoSeconds(startedAt) });
