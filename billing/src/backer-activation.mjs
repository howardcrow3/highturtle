// Backer online activation: "2 computers per key".
//
// Backer keys stay what they always were: offline-checkable, signed, tied to an email (see license.mjs). Activation
// adds a server-side count of computers per key. The app sends its key and a machine fingerprint; if the key is
// genuine and has a free seat (or this computer already holds one), the server answers with a signed activation
// token that the app checks offline with the same public key it uses for license keys.
//
//   POST /api/backer/v1/activate    {key, machine, app_version, platform} -> 200 {token} | 404 unknown_key | 403 revoked | 409 seats_full
//   POST /api/backer/v1/deactivate  {key, machine}                        -> 204 | 404 unknown_key
//
// Existing keys need no migration: a key's row is created the first time it is activated, after its signature checks out.
// The row id is the SHA-256 of the key's bytes, so the key text itself is never stored in the activation table.
//
// Token: base64url(json) + "." + base64url(Ed25519 signature over "backer-activation-v1\0" + json bytes), no padding.
// The domain prefix keeps an activation signature from ever being mistaken for a license-key signature (and vice versa).
// A token is good for 90 days offline and the app asks for a fresh one after 7, so the license service being down
// never stops a backup. Only a definite answer from the server (seats_full, revoked, key unknown) ends a license early.

import { createHash } from 'node:crypto';
import { publicKeyHex } from './license.mjs';

const PREFIX = '/api/backer/v1/';
const MACHINE_RE = /^[A-Za-z0-9+/=_-]{8,128}$/;
const DOMAIN = new TextEncoder().encode('backer-activation-v1\0');
const LICENSE_DOMAIN = new TextEncoder().encode('backer-license-v1\0');
export const REFRESH_AFTER_DAYS = 7;
export const TOKEN_VALID_DAYS = 90;
const DAY_MS = 86_400_000;

const hex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const isoSeconds = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

const A32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function unbase32(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of text) {
    const i = A32.indexOf(c);
    if (i < 0) return null;
    value = ((value << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}

// Same leniency as the app: with or without BACKER-, dashes, spaces, any case.
function decodeKey(input) {
  const upper = String(input ?? '').trim().toUpperCase();
  const body = /^BACKER[-\s]/.test(upper) ? upper.slice(6) : upper;
  const clean = body.replace(/[^A-Z0-9]/g, '');
  return clean ? unbase32(clean) : null;
}

// Checks the key's signature with the public key the app trusts. Returns {keyId, email, major} or null.
export async function openKey(input, publicKey) {
  const raw = decodeKey(input);
  if (!raw || raw.length < 8 + 64) return null;
  const payload = raw.subarray(0, raw.length - 64), sig = raw.subarray(raw.length - 64);
  const n = payload[7];
  if (payload[0] !== 1 || n === 0 || n > 80 || payload.length !== 8 + n) return null;
  const pub = await crypto.subtle.importKey('raw', hex(publicKey), { name: 'Ed25519' }, false, ['verify']);
  const msg = new Uint8Array(LICENSE_DOMAIN.length + payload.length);
  msg.set(LICENSE_DOMAIN); msg.set(payload, LICENSE_DOMAIN.length);
  if (!(await crypto.subtle.verify('Ed25519', pub, sig, msg))) return null;
  return {
    keyId: createHash('sha256').update(raw).digest('hex'),
    email: new TextDecoder().decode(payload.subarray(8)),
    major: payload[2],
  };
}

// The id the activation table uses for a key text, without checking the signature (for keys we issued ourselves).
export function keyIdOf(input) {
  const raw = decodeKey(input);
  return raw && raw.length >= 8 + 64 ? createHash('sha256').update(raw).digest('hex') : null;
}

async function importSeed(seedHex) {
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...hex(seedHex.trim())]);
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
}

export async function signActivation(seedHex, { keyId, machine, issuedAt }) {
  const claims = {
    kind: 'backer-activation', key_id: keyId, machine,
    issued_at: isoSeconds(issuedAt),
    refresh_after: isoSeconds(new Date(issuedAt).getTime() + REFRESH_AFTER_DAYS * DAY_MS),
    expires_at: isoSeconds(new Date(issuedAt).getTime() + TOKEN_VALID_DAYS * DAY_MS),
  };
  const payload = new TextEncoder().encode(JSON.stringify(claims));
  const msg = new Uint8Array(DOMAIN.length + payload.length);
  msg.set(DOMAIN); msg.set(payload, DOMAIN.length);
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', await importSeed(seedHex), msg));
  return { token: `${b64url(payload)}.${b64url(sig)}`, claims };
}

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: obj === undefined ? '' : JSON.stringify(obj),
});

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

export const isBackerPath = (path) => path.startsWith(PREFIX);

// `store` has the same shape as the CeeVee store (createLicense / getLicense / activateSeat / releaseSeat), keyed by key id.
export function makeBackerApi({ cfg, store, log = () => {}, now = () => new Date() }) {
  let configured; // does the signing key match the public key the shipped app trusts? Checked once.
  async function ready() {
    if (configured === undefined) {
      configured = false;
      if (cfg.backerSigningKey) {
        try { configured = (await publicKeyHex(cfg.backerSigningKey)) === cfg.backerPublicKey; } catch { configured = false; }
      }
    }
    return configured;
  }

  async function activate(body) {
    const key = await openKey(body.key, cfg.backerPublicKey);
    if (!key) return json(404, { error: 'unknown_key' });
    if (typeof body.machine !== 'string' || !MACHINE_RE.test(body.machine)) return json(400, { error: 'bad_request' });
    const meta = {
      app_version: String(body.app_version ?? '').slice(0, 32),
      platform: String(body.platform ?? '').slice(0, 16),
    };
    await store.createLicense({ license_key: key.keyId, email: key.email, seats: cfg.backerSeats, major: key.major });
    const result = await store.activateSeat(key.keyId, body.machine, meta, now());
    if (result === 'missing') return json(403, { error: 'revoked', message: 'This license key has been deactivated. Contact info@turtlebox.studio if you think that is a mistake.' });
    if (result === 'full') {
      return json(409, {
        error: 'seats_full',
        message: `This key is already active on ${cfg.backerSeats} computers. Deactivate Backer on one of them (Settings, License), or free a seat at ${cfg.site}/account/.`,
      });
    }
    const { token, claims } = await signActivation(cfg.backerSigningKey, { keyId: key.keyId, machine: body.machine, issuedAt: now() });
    log({ backer: 'activated', key_tail: key.keyId.slice(-6), platform: meta.platform });
    return json(200, { token, refresh_after: claims.refresh_after, expires_at: claims.expires_at });
  }

  async function deactivate(body) {
    const key = await openKey(body.key, cfg.backerPublicKey);
    if (!key || typeof body.machine !== 'string' || !MACHINE_RE.test(body.machine)) return json(404, { error: 'unknown_key' });
    const result = await store.releaseSeat(key.keyId, body.machine);
    if (result === 'missing') return json(204); // never activated, so nothing to free
    log({ backer: 'deactivated', key_tail: key.keyId.slice(-6) });
    return json(204);
  }

  return async function handle(event, method, path) {
    if (method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const route = path.slice(PREFIX.length);
    if (route !== 'activate' && route !== 'deactivate') return json(404, { error: 'not found' });
    if (!(await ready())) {
      log({ error: 'BACKER_SIGNING_KEY is missing or does not match BACKER_PUBLIC_KEY' });
      return json(503, { error: 'unavailable', message: 'Licensing is not available yet. Please try again later.' });
    }
    const body = parseBody(event);
    if (!body) return json(400, { error: 'bad_request' });
    return route === 'activate' ? activate(body) : deactivate(body);
  };
}
