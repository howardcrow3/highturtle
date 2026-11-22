import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, verify, randomBytes } from 'node:crypto';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { makeApp } from '../src/handler.mjs';
import { MemoryStore } from '../src/store.mjs';
import { CeeveeMemoryStore } from '../src/ceevee-store.mjs';
import { makeBackerFulfillment } from '../src/fulfillment.mjs';
import { issueKey, publicKeyHex } from '../src/license.mjs';
import { keyIdOf } from '../src/backer-activation.mjs';
import { signToken } from '../src/session.mjs';
import { SECRET, sign, webhookEvent, customerEvent, transactionCompletedEvent } from './fixtures.mjs';

const SEED = randomBytes(32).toString('hex');
const PUB_HEX = await publicKeyHex(SEED);
const PUB = createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(SEED, 'hex')]), format: 'der', type: 'pkcs8' }));
const [A, B, C] = ['a', 'b', 'c'].map((c) => c.repeat(64));
const T0 = new Date('2026-12-05T12:00:00.000Z');

// Opens a token the way the app does: Ed25519 over "backer-activation-v1\0" + the json bytes.
function open(token) {
  const [p, s] = token.split('.');
  const payload = Buffer.from(p, 'base64url');
  const msg = Buffer.concat([Buffer.from('backer-activation-v1\0'), payload]);
  assert.ok(verify(null, msg, PUB, Buffer.from(s, 'base64url')), 'signature verifies');
  assert.ok(!token.includes('='), 'no padding');
  return JSON.parse(payload.toString());
}

function setup(over = {}) {
  const store = new MemoryStore();
  const backer = new CeeveeMemoryStore();
  const sent = [];
  const paddle = new Paddle('test_key_not_used', { environment: Environment.sandbox });
  const cfg = {
    paddleWebhookSecret: SECRET, sessionSecret: 's', site: 'https://turtlebox.studio', pastDuePolicy: 'grant',
    backerPriceIds: ['pri_backer'], backerSigningKey: SEED, backerPublicKey: PUB_HEX, backerSeats: 2, opsEmail: 'ops@example.com', ...over,
  };
  const sendEmail = async (m) => sent.push(m);
  const fulfil = makeBackerFulfillment({ cfg, store, paddle, sendEmail, log: () => {} });
  let now = T0;
  const app = makeApp({ cfg, store, paddle, sendEmail, onPurchase: fulfil, backer, now: () => now });
  const call = (route, body) => app({
    rawPath: `/api/backer/v1/${route}`, requestContext: { http: { method: 'POST' } }, headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const deliver = (payload) => { const b = JSON.stringify(payload); return app(webhookEvent(b, sign(b))); };
  return { app, store, backer, sent, call, deliver, cfg, setNow: (d) => { now = d; } };
}
const activate = (s, key, machine) => s.call('activate', { key, machine, app_version: '1.0.0', platform: 'macos' });
const body = (r) => JSON.parse(r.body);

test('an existing key activates with no setup and gets a signed token bound to its key and computer', async () => {
  const s = setup();
  const key = await issueKey(SEED, 'Buyer@Example.com');
  const r = await activate(s, key, A);
  assert.equal(r.statusCode, 200);
  const c = open(body(r).token);
  assert.equal(c.kind, 'backer-activation');
  assert.equal(c.key_id, keyIdOf(key));
  assert.equal(c.machine, A);
  assert.equal(c.issued_at, '2026-12-05T12:00:00Z');
  assert.equal(c.refresh_after, '2026-12-12T12:00:00Z');
  assert.equal(c.expires_at, '2027-03-05T12:00:00Z');
});

test('a third computer is refused, the same computer can ask again, and a messy copy of the key counts as the same key', async () => {
  const s = setup();
  const key = await issueKey(SEED, 'buyer@example.com');
  assert.equal((await activate(s, key, A)).statusCode, 200);
  assert.equal((await activate(s, key.toLowerCase().replaceAll('-', ' '), B)).statusCode, 200);
  const third = await activate(s, key, C);
  assert.equal(third.statusCode, 409);
  assert.equal(body(third).error, 'seats_full');
  assert.match(body(third).message, /account/);
  assert.equal((await activate(s, key, A)).statusCode, 200, 'a computer that already holds a seat is never refused');
});

test('deactivating frees the seat for another computer', async () => {
  const s = setup();
  const key = await issueKey(SEED, 'buyer@example.com');
  await activate(s, key, A); await activate(s, key, B);
  assert.equal((await s.call('deactivate', { key, machine: A })).statusCode, 204);
  assert.equal((await activate(s, key, C)).statusCode, 200);
  assert.equal((await activate(s, key, A)).statusCode, 409, 'A gave up its seat and C took it');
  assert.equal((await s.call('deactivate', { key, machine: 'z'.repeat(64) })).statusCode, 204, 'freeing a computer that never held a seat is harmless');
});

test('keys are counted separately and forged or foreign keys are refused without touching the table', async () => {
  const s = setup();
  const k1 = await issueKey(SEED, 'one@example.com'), k2 = await issueKey(SEED, 'two@example.com');
  await activate(s, k1, A); await activate(s, k1, B);
  assert.equal((await activate(s, k2, C)).statusCode, 200);
  const foreign = await issueKey(randomBytes(32).toString('hex'), 'one@example.com');
  assert.equal((await activate(s, foreign, A)).statusCode, 404);
  assert.equal((await activate(s, 'BACKER-AAAAA-AAAAA', A)).statusCode, 404);
  assert.equal((await activate(s, '', A)).statusCode, 404);
  assert.equal(s.backer.licenses.size, 2, 'only genuine keys get a row');
});

test('a revoked key is refused with its own answer', async () => {
  const s = setup();
  const key = await issueKey(SEED, 'buyer@example.com');
  await activate(s, key, A);
  await s.backer.revokeLicense(keyIdOf(key));
  const r = await activate(s, key, B);
  assert.equal(r.statusCode, 403);
  assert.equal(body(r).error, 'revoked');
});

test('bad requests, wrong methods and a missing or mismatched signing key', async () => {
  const s = setup();
  const key = await issueKey(SEED, 'buyer@example.com');
  assert.equal((await s.call('activate', { key, machine: 'x' })).statusCode, 400);
  assert.equal((await s.call('activate', 'not json')).statusCode, 400);
  assert.equal((await s.call('nope', {})).statusCode, 404);
  const get = await s.app({ rawPath: '/api/backer/v1/activate', requestContext: { http: { method: 'GET' } }, headers: {} });
  assert.equal(get.statusCode, 405);
  assert.equal((await setup({ backerSigningKey: '' }).call('activate', { key, machine: A })).statusCode, 503);
  assert.equal((await setup({ backerPublicKey: '00'.repeat(32) }).call('activate', { key, machine: A })).statusCode, 503);
});

const me = (s, email = 'buyer@example.com') => s.app({
  rawPath: '/api/billing/me', requestContext: { http: { method: 'GET' } }, headers: {},
  cookies: [`tb_account=${signToken(s.cfg.sessionSecret, 'session', { e: email }, 3600)}`],
});
const release = (s, payload, { email = 'buyer@example.com', type = 'application/json' } = {}) => s.app({
  rawPath: '/api/billing/release', requestContext: { http: { method: 'POST' } }, headers: { 'content-type': type },
  cookies: [`tb_account=${signToken(s.cfg.sessionSecret, 'session', { e: email }, 3600)}`], body: JSON.stringify(payload),
});

test('the owner sees their computers on the account page and can free one; others cannot', async () => {
  const s = setup();
  await s.deliver(customerEvent('customer.created'));
  assert.equal((await s.deliver(transactionCompletedEvent({ priceId: 'pri_backer' }))).statusCode, 200);
  assert.match(s.sent[0].text, /2 computers/);
  const key = s.sent[0].text.match(/BACKER(-[A-Z2-7]{5})+(-[A-Z2-7]{1,5})?/)[0];
  await activate(s, key, A); await activate(s, key, B);
  const lic = body(await me(s)).licenses.find((l) => l.key === key);
  assert.equal(lic.seats, 2); assert.equal(lic.seats_used, 2);
  assert.deepEqual(lic.machines.map((m) => m.id), [A.slice(0, 12), B.slice(0, 12)]);
  assert.ok(!JSON.stringify(lic).includes(A), 'the full machine hash never reaches the page');
  assert.equal((await release(s, { key, id: lic.machines[0].id }, { email: 'other@example.com' })).statusCode, 404);
  assert.equal((await release(s, { key, id: lic.machines[0].id }, { type: 'text/plain' })).statusCode, 415);
  assert.equal((await release(s, { key, id: lic.machines[0].id })).statusCode, 200);
  assert.equal((await activate(s, key, C)).statusCode, 200, 'the freed seat can be taken');
});

test('a two-unit order gets two different keys, each with its own 2 computers', async () => {
  const s = setup();
  await s.deliver(customerEvent('customer.created'));
  assert.equal((await s.deliver(transactionCompletedEvent({ priceId: 'pri_backer', quantity: 2 }))).statusCode, 200);
  const keys = s.sent[0].text.match(/BACKER(-[A-Z2-7]{1,5})+/g);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  for (const m of [A, B]) { assert.equal((await activate(s, keys[0], m)).statusCode, 200); }
  assert.equal((await activate(s, keys[0], C)).statusCode, 409);
  assert.equal((await activate(s, keys[1], C)).statusCode, 200);
});
