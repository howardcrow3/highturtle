// Backer license keys. Byte-for-byte the same format as howardcrow3/Backer tools/key-issuer/issuer.mjs and
// crates/backer-license (Ed25519 over "backer-license-v1\0" + payload, base32 in groups of five). The
// private signing key lives only in AWS Secrets Manager; the app checks keys with its built-in public key.

const DOMAIN = new TextEncoder().encode('backer-license-v1\0');
const FORMAT = 1, EDITION_STANDARD = 1, MAJOR = 1, MAX_EMAIL = 80;

const hex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));

function base32(bytes) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

export function payloadFor(email, issuedDay) {
  const e = new TextEncoder().encode(email.trim().toLowerCase());
  if (e.length === 0 || e.length > MAX_EMAIL) throw new Error('bad email');
  const p = new Uint8Array(8 + e.length);
  p.set([FORMAT, EDITION_STANDARD, MAJOR, (issuedDay >>> 24) & 255, (issuedDay >>> 16) & 255, (issuedDay >>> 8) & 255, issuedDay & 255, e.length]);
  p.set(e, 8);
  return p;
}

// Public half (hex) of an Ed25519 seed, so a signing key can be checked against the key built into the app.
export async function publicKeyHex(seedHex) {
  const seed = seedHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) throw new Error('signing key must be 64 hex characters');
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...hex(seed)]);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return Buffer.from(jwk.x, 'base64url').toString('hex');
}

export async function issueKey(seedHex, email, issuedDay = Math.floor(Date.now() / 86400000)) {
  const seed = seedHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) throw new Error('signing key must be 64 hex characters');
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...hex(seed)]);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const payload = payloadFor(email, issuedDay);
  const msg = new Uint8Array(DOMAIN.length + payload.length);
  msg.set(DOMAIN); msg.set(payload, DOMAIN.length);
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, msg));
  const raw = new Uint8Array(payload.length + sig.length);
  raw.set(payload); raw.set(sig, payload.length);
  return 'BACKER-' + base32(raw).match(/.{1,5}/g).join('-');
}
