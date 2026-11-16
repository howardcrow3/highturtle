import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, verify, randomBytes } from 'node:crypto';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { makeApp } from '../src/handler.mjs';
import { MemoryStore } from '../src/store.mjs';
import { CeeveeMemoryStore } from '../src/ceevee-store.mjs';
import { makeCeeveeFulfillment } from '../src/ceevee-fulfillment.mjs';
import { makeBackerFulfillment } from '../src/fulfillment.mjs';
import { normalizeKey, deriveKey } from '../src/ceevee.mjs';
import { SECRET, sign, webhookEvent, customerEvent, transactionCompletedEvent, adjustmentEvent } from './fixtures.mjs';
import { makeCeeveeRefund } from '../src/ceevee-fulfillment.mjs';
import { signToken } from '../src/session.mjs';

const SEED = randomBytes(32).toString('hex');
const PKCS8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(SEED, 'hex')]);
const PUB = createPublicKey(createPrivateKey({ key: PKCS8, format: 'der', type: 'pkcs8' }));
const MACHINE_A = 'a'.repeat(64), MACHINE_B = 'b'.repeat(64), MACHINE_C = 'c'.repeat(64);

// Verifies a token exactly the way the app's token.rs does: base64url(json).base64url(sig), sig over the json bytes.
function open(token) {
  const [p, s] = token.split('.');
  const payload = Buffer.from(p, 'base64url');
  assert.ok(verify(null, payload, PUB, Buffer.from(s, 'base64url')), 'signature verifies');
  assert.ok(!token.includes('='), 'no padding');
  return JSON.parse(payload.toString());
}

function setup(over = {}) {
  const store = new MemoryStore();
  const ceevee = new CeeveeMemoryStore();
  const sent = [];
  const paddle = new Paddle('test_key_not_used', { environment: Environment.sandbox });
  const cfg = {
    paddleWebhookSecret: SECRET, sessionSecret: 's', site: 'https://turtlebox.studio', pastDuePolicy: 'grant',
    ceeveePriceIds: ['pri_ceevee'], ceeveeSigningKey: SEED, ceeveeSeats: 2, ceeveeMajor: 1, opsEmail: 'ops@example.com', ...over,
  };
  const log = () => {};
  const sendEmail = async (m) => sent.push(m);
  const fulfil = makeCeeveeFulfillment({ cfg, store, ceevee, paddle, sendEmail, log });
  const backer = makeBackerFulfillment({ cfg: { ...cfg, backerPriceIds: ['pri_backer'] }, store, paddle, sendEmail, log });
  const onPurchase = async (t) => { await backer(t); await fulfil(t); };
  const now = new Date('2026-12-05T12:00:00.123Z');
  const onRefund = makeCeeveeRefund({ cfg, ceevee, log });
  const app = makeApp({ cfg, store, paddle, sendEmail, onPurchase, onRefund, ceevee, now: () => now });
  const deliver = (payload) => { const b = JSON.stringify(payload); return app(webhookEvent(b, sign(b))); };
  const call = (route, body, method = 'POST') => app({
    rawPath: `/api/ceevee/v1/${route}`, requestContext: { http: { method } }, headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { app, store, ceevee, sent, deliver, call, cfg };
}

async function buy(s, opts = {}) {
  await s.deliver(customerEvent('customer.created'));
  const res = await s.deliver(transactionCompletedEvent({ priceId: 'pri_ceevee', ...opts }));
  assert.equal(res.statusCode, 200);
}
const keyFrom = (mail) => mail.text.match(/CEEV(-[0-9A-Z]{5}){4}/)[0];

test('key derivation is deterministic, well formed, and survives the app normaliser', () => {
  const k = deriveKey(SEED, 'txn_1', 0);
  assert.match(k, /^CEEV(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
  assert.equal(deriveKey(SEED, 'txn_1', 0), k);
  assert.notEqual(deriveKey(SEED, 'txn_1', 1), k);
  assert.notEqual(deriveKey(SEED, 'txn_2', 0), k);
  assert.equal(normalizeKey(k), k);
  assert.equal(normalizeKey(` ${k.toLowerCase().replaceAll('-', ' ')} `), k);
  assert.equal(normalizeKey('CEEV-OOOOO-IIIII-LLLLL-00000'), 'CEEV-00000-11111-11111-00000');
  for (const bad of ['', 'CEEV', 'ABCD-7KQ2M-9XB4D-TR5VW-H3NZ8', 'CEEV-7KQ2M-9XB4D-TR5VW', 'CEEV-7KQ2M-9XB4D-TR5VW-H3NZ8X', 'CEEV-7KQ2M-9XB4D-TR5VW-H3NU!']) {
    assert.equal(normalizeKey(bad), null, bad);
  }
});

test('a CeeVee purchase creates a license and emails the key and activation link', async () => {
  const s = setup();
  await buy(s);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].to, 'Buyer@Example.com');
  const key = keyFrom(s.sent[0]);
  assert.ok(s.sent[0].text.includes(`ceevee://activate?key=${key}`));
  const lic = await s.ceevee.getLicense(key);
  assert.equal(lic.seats, 2);
  assert.equal(lic.transaction_id, 'txn_01');
});

test('redelivery does not email twice, and a retry after a mail failure sends the same key', async () => {
  const s = setup();
  await buy(s);
  await s.deliver(transactionCompletedEvent({ priceId: 'pri_ceevee' }));
  assert.equal(s.sent.length, 1);

  const f = setup();
  let fail = true;
  const realSend = f.sent.push.bind(f.sent);
  const paddle = new Paddle('x', { environment: Environment.sandbox });
  const flaky = makeCeeveeFulfillment({
    cfg: f.cfg, store: f.store, ceevee: f.ceevee, paddle, log() {},
    sendEmail: async (m) => { if (fail) throw new Error('ses down'); realSend(m); },
  });
  await f.store.upsertCustomer({ customer_id: 'ctm_01', email: 'b@example.com', email_lc: 'b@example.com' }, 'v');
  const txn = { id: 'txn_77', customerId: 'ctm_01', items: [{ price: { id: 'pri_ceevee' }, quantity: 1 }] };
  await assert.rejects(flaky(txn));
  fail = false;
  await flaky(txn);
  assert.equal(f.sent.length, 1);
  assert.equal(keyFrom(f.sent[0]), deriveKey(SEED, 'txn_77', 0));
});

test('other products, and Backer orders, do not create CeeVee licenses', async () => {
  const s = setup();
  await s.deliver(customerEvent('customer.created'));
  await s.deliver(transactionCompletedEvent({ priceId: 'pri_other' }));
  await s.deliver(transactionCompletedEvent({ id: 'txn_02', priceId: 'pri_backer' }));
  assert.equal(s.ceevee.licenses.size, 0);
  assert.equal(s.sent.length, 1); // the Backer mail only (no Backer signing key: it goes to ops)
});

test('quantity 2 creates two separate keys in one email', async () => {
  const s = setup();
  await buy(s, { quantity: 2 });
  assert.equal(s.ceevee.licenses.size, 2);
  assert.equal(s.sent.length, 1);
});

test('no signing key: nothing is issued, ops is told, and the event is not marked done', async () => {
  const s = setup({ ceeveeSigningKey: '' });
  await buy(s);
  assert.equal(s.ceevee.licenses.size, 0);
  assert.equal(s.sent[0].to, 'ops@example.com');
  assert.equal(s.store.transactions.get('txn_01').ceevee_fulfillment_status, undefined);
});

test('activate returns a license token the app would accept, for this machine only', async () => {
  const s = setup();
  await buy(s);
  const key = keyFrom(s.sent[0]);
  const res = await s.call('activate', { key: key.toLowerCase(), machine: MACHINE_A, app_version: '0.1.0', platform: 'windows' });
  assert.equal(res.statusCode, 200);
  const claims = open(JSON.parse(res.body).license);
  assert.deepEqual(claims, { kind: 'license', key, machine: MACHINE_A, issued_at: '2026-12-05T12:00:00Z', major: 1, seats: 2 });
});

test('the third computer is refused, a known computer can re-activate, and freeing a seat helps', async () => {
  const s = setup();
  await buy(s);
  const key = keyFrom(s.sent[0]);
  const act = (m) => s.call('activate', { key, machine: m, app_version: '1', platform: 'macos' });
  assert.equal((await act(MACHINE_A)).statusCode, 200);
  assert.equal((await act(MACHINE_B)).statusCode, 200);
  const full = await act(MACHINE_C);
  assert.equal(full.statusCode, 409);
  assert.equal(JSON.parse(full.body).error, 'seats_full');
  assert.equal((await act(MACHINE_A)).statusCode, 200);
  assert.equal((await s.call('deactivate', { key, machine: MACHINE_A })).statusCode, 204);
  assert.equal((await act(MACHINE_C)).statusCode, 200);
});

test('unknown, malformed and revoked keys are 404 unknown_key', async () => {
  const s = setup();
  await buy(s);
  const key = keyFrom(s.sent[0]);
  for (const bad of ['CEEV-AAAAA-AAAAA-AAAAA-AAAAA', 'nope', '', undefined]) {
    const res = await s.call('activate', { key: bad, machine: MACHINE_A });
    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error, 'unknown_key');
  }
  await s.ceevee.revokeLicense(key);
  assert.equal((await s.call('activate', { key, machine: MACHINE_A })).statusCode, 404);
  assert.equal((await s.call('deactivate', { key: 'CEEV-AAAAA-AAAAA-AAAAA-AAAAA', machine: MACHINE_A })).statusCode, 404);
});

test('trial: the server keeps the first start it saw for a machine', async () => {
  const s = setup();
  const r1 = await s.call('trial', { machine: MACHINE_A });
  assert.deepEqual(open(JSON.parse(r1.body).token), { kind: 'trial', machine: MACHINE_A, started_at: '2026-12-05T12:00:00Z' });
  await s.ceevee.trials.set(MACHINE_A, '2026-11-01T00:00:00.000Z');
  const r2 = await s.call('trial', { machine: MACHINE_A });
  assert.equal(open(JSON.parse(r2.body).token).started_at, '2026-11-01T00:00:00Z');
});

test('bad requests: junk body, bad machine, wrong method, unknown route, no signing key', async () => {
  const s = setup();
  assert.equal((await s.call('trial', 'not json')).statusCode, 400);
  assert.equal((await s.call('trial', { machine: 'x' })).statusCode, 400);
  assert.equal((await s.call('activate', { key: 'CEEV-AAAAA-AAAAA-AAAAA-AAAAA', machine: '<script>' })).statusCode, 400);
  assert.equal((await s.call('trial', {}, 'GET')).statusCode, 405);
  assert.equal((await s.call('nothing', {})).statusCode, 404);
  const off = setup({ ceeveeSigningKey: '' });
  assert.equal((await off.call('trial', { machine: MACHINE_A })).statusCode, 503);
});

const activate = (s, key, machine) => s.call('activate', { key, machine, app_version: '1', platform: 'windows' });

test('a full approved refund revokes the key; partial, pending and other actions do not', async () => {
  const s = setup();
  await buy(s);
  const key = keyFrom(s.sent[0]);
  for (const odd of [{ adjType: 'partial' }, { status: 'pending_approval' }, { action: 'credit' }, { transaction: 'txn_other' }]) {
    await s.deliver(adjustmentEvent('adjustment.updated', odd));
    assert.equal((await s.ceevee.getLicense(key)).status, 'active', JSON.stringify(odd));
  }
  assert.equal((await activate(s, key, MACHINE_A)).statusCode, 200);
  const res = await s.deliver(adjustmentEvent('adjustment.updated'));
  assert.equal(res.statusCode, 200);
  assert.equal((await s.ceevee.getLicense(key)).status, 'revoked');
  assert.equal((await activate(s, key, MACHINE_B)).statusCode, 404);
  assert.equal((await s.deliver(adjustmentEvent('adjustment.created', { id: 'adj_02' }))).statusCode, 200); // redelivery is harmless
});

test('a refund revokes every key bought in that transaction', async () => {
  const s = setup();
  await buy(s, { quantity: 2 });
  await s.deliver(adjustmentEvent('adjustment.updated'));
  assert.deepEqual([...s.ceevee.licenses.values()].map((l) => l.status), ['revoked', 'revoked']);
});

function accountCall(s, body, { signedIn = true, email = 'buyer@example.com', type = 'application/json' } = {}) {
  const tok = signToken(s.cfg.sessionSecret, 'session', { e: email }, 3600);
  return s.app({
    rawPath: '/api/billing/ceevee/release', requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': type }, cookies: signedIn ? [`tb_account=${tok}`] : [], body: JSON.stringify(body),
  });
}

test('the owner can free a seat from the account page; the profile lists computers by short id', async () => {
  const s = setup();
  await buy(s);
  const key = keyFrom(s.sent[0]);
  await activate(s, key, MACHINE_A);
  await activate(s, key, MACHINE_B);
  const tok = signToken(s.cfg.sessionSecret, 'session', { e: 'buyer@example.com' }, 3600);
  const me = JSON.parse((await s.app({ rawPath: '/api/billing/me', requestContext: { http: { method: 'GET' } }, headers: {}, cookies: [`tb_account=${tok}`] })).body);
  const lic = me.licenses.find((l) => l.key === key);
  assert.equal(lic.seats_used, 2);
  assert.deepEqual(lic.machines.map((m) => m.id), [MACHINE_A.slice(0, 12), MACHINE_B.slice(0, 12)]);
  assert.ok(!JSON.stringify(me).includes(MACHINE_A), 'the full machine hash is never sent to the page');
  const res = await accountCall(s, { key, id: lic.machines[0].id });
  assert.equal(res.statusCode, 200);
  assert.equal((await activate(s, key, MACHINE_C)).statusCode, 200); // the freed seat can be taken
});

test('freeing a seat needs sign-in, the owner, JSON and a known computer', async () => {
  const s = setup();
  await buy(s);
  const key = keyFrom(s.sent[0]);
  await activate(s, key, MACHINE_A);
  const id = MACHINE_A.slice(0, 12);
  assert.equal((await accountCall(s, { key, id }, { signedIn: false })).statusCode, 401);
  assert.equal((await accountCall(s, { key, id }, { email: 'someone@else.com' })).statusCode, 404);
  assert.equal((await accountCall(s, { key, id }, { type: 'application/x-www-form-urlencoded' })).statusCode, 415);
  assert.equal((await accountCall(s, { key, id: 'zzzzzzzzzzzz' })).statusCode, 404);
  assert.equal((await accountCall(s, { key: 'nope', id })).statusCode, 400);
  assert.equal(Object.keys((await s.ceevee.getLicense(key)).machines).length, 1, 'nothing was freed by the refused calls');
});
