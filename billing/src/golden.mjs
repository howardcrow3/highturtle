// Golden licence tokens. Same format as crates/fin-license in howardcrow3/golden: base64url(JSON payload) "."
// base64url(Ed25519 signature over those JSON bytes). The app verifies offline with its built-in public key,
// so the private seed (GOLDEN_SIGNING_KEY, base64url, 32 bytes) lives only in Secrets Manager.

const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
const MAJOR = 1;

function seedBytes(seed) {
  const b = Buffer.from((seed || '').trim(), 'base64url');
  if (b.length !== 32) throw new Error('GOLDEN_SIGNING_KEY must be a 32-byte base64url key');
  return b;
}

async function importKey(seed, extractable = false) {
  const der = new Uint8Array(48);
  der.set(PKCS8_PREFIX);
  der.set(seedBytes(seed), 16);
  return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, extractable, ['sign']);
}

/** Public half (base64url) of a signing seed, for license_public_key.txt in the app. */
export async function goldenPublicKey(seed) {
  const jwk = await crypto.subtle.exportKey('jwk', await importKey(seed, true));
  return jwk.x; // JWK x is already base64url without padding
}

export function goldenPayload({ issued, plaidUntil = null, buyer, core }) {
  // Field order matches Rust's LicensePayload. `core` says whether the key unlocks the app (false: the
  // bank add-on bought on its own). Left out, the key is the legacy form, which the app treats as the app.
  const p = { product: 'golden', major: MAJOR, issued, plaid_until: plaidUntil, buyer };
  if (typeof core === 'boolean') p.core = core;
  return JSON.stringify(p);
}

export async function issueGoldenToken(seed, fields) {
  const body = new TextEncoder().encode(goldenPayload(fields));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, await importKey(seed), body));
  return `${Buffer.from(body).toString('base64url')}.${Buffer.from(sig).toString('base64url')}`;
}

const day = (t) => (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null);

/** Add calendar months, clamping to a shorter month's end (Jan 31 + 1 = Feb 28), like chrono. */
export function addMonths(isoDay, n) {
  const [y, m, d] = isoDay.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const p = (x) => String(x).padStart(2, '0');
  return `${ny}-${p(nm)}-${p(Math.min(d, last))}`;
}

/** Licence fields for a completed transaction: what was bought and the add-on's paid-through date. */
export function goldenFields(txn, { priceId, plaidPriceId, plaidYearlyPriceId }) {
  let core = 0, plaid = 0, yearly = false;
  for (const i of txn.items || []) {
    const id = i.price?.id;
    if (id && id === priceId) core += i.quantity || 1;
    else if (id && id === plaidPriceId) plaid += i.quantity || 1;
    else if (id && id === plaidYearlyPriceId) { plaid += i.quantity || 1; yearly = true; }
  }
  if (!core && !plaid) return null;
  const issued = day(txn.billedAt) || day(txn.createdAt);
  if (!issued) throw new Error(`no date on transaction ${txn.id}`);
  const plaidUntil = plaid ? (day(txn.billingPeriod?.endsAt) || addMonths(issued, yearly ? 12 : 1)) : null;
  return { core, plaid, issued, plaidUntil };
}
