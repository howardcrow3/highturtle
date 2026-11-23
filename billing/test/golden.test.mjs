import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { makeApp } from '../src/handler.mjs';
import { MemoryStore } from '../src/store.mjs';
import { makeGoldenFulfillment } from '../src/golden-fulfillment.mjs';
import { issueGoldenToken, goldenPublicKey, goldenFields, addMonths } from '../src/golden.mjs';
import { SECRET, sign, webhookEvent, customerEvent, transactionCompletedEvent } from './fixtures.mjs';

// Made by the Rust tool in howardcrow3/golden: golden-license issue <this seed> ctm_fixture 2026-11-18 [2026-12-18].
// The same bytes are pinned there, so the app and this service cannot drift apart.
const SEED = Buffer.alloc(32, 7).toString('base64url');
const RUST_WITH_PLAID = 'eyJwcm9kdWN0IjoiZ29sZGVuIiwibWFqb3IiOjEsImlzc3VlZCI6IjIwMjYtMTEtMTgiLCJwbGFpZF91bnRpbCI6IjIwMjYtMTItMTgiLCJidXllciI6ImN0bV9maXh0dXJlIn0.E1ZYwMv0TqZ3izTtBwqX2gICVC_UUOBCjKMUFf6ns2qqjLf8kgmdmmZMlXamZv5uPFriqZ5CaGQpRuTGAIcFCg';

test('tokens are byte-identical to the Rust tool', async () => {
  assert.equal(await issueGoldenToken(SEED, { issued: '2026-11-18', plaidUntil: '2026-12-18', buyer: 'ctm_fixture' }), RUST_WITH_PLAID);
  const none = await issueGoldenToken(SEED, { issued: '2026-11-18', buyer: 'ctm_fixture' });
  assert.equal(none, 'eyJwcm9kdWN0IjoiZ29sZGVuIiwibWFqb3IiOjEsImlzc3VlZCI6IjIwMjYtMTEtMTgiLCJwbGFpZF91bnRpbCI6bnVsbCwiYnV5ZXIiOiJjdG1fZml4dHVyZSJ9.FpUHS8cx0qPICUpJJUTJROxYqdLPeUTxA2d3DyWDSuRZQLwJlqJsb301yk7AEHoGbmwtI-xiOOvK_oRG4-ApCA');
});

test('the public key matches the seed', async () => {
  const pub = await goldenPublicKey(SEED);
  const [p, s] = RUST_WITH_PLAID.split('.');
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub, 'base64url')]);
  assert.ok(verify(null, Buffer.from(p, 'base64url'), createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(s, 'base64url')));
});

test('a malformed seed is refused', async () => {
  await assert.rejects(issueGoldenToken('short', { issued: '2026-11-18', buyer: 'x' }), /32-byte/);
});

test('addMonths clamps like chrono', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
});

const ids = { priceId: 'pri_core', plaidPriceId: 'pri_plaid', plaidYearlyPriceId: 'pri_year' };
const txnOf = (items, extra = {}) => ({ id: 'txn_1', billedAt: '2026-11-20T10:00:00Z', items: items.map((id) => ({ price: { id }, quantity: 1 })), ...extra });

test('goldenFields: core, plaid, both, neither', () => {
  assert.deepEqual(goldenFields(txnOf(['pri_core']), ids), { core: 1, plaid: 0, issued: '2026-11-20', plaidUntil: null });
  assert.equal(goldenFields(txnOf(['pri_plaid']), ids).plaidUntil, '2026-12-20');
  assert.equal(goldenFields(txnOf(['pri_plaid'], { billingPeriod: { endsAt: '2026-12-22T00:00:00Z' } }), ids).plaidUntil, '2026-12-22');
  assert.equal(goldenFields(txnOf(['pri_core', 'pri_plaid']), ids).core, 1);
  // The yearly add-on runs a year from purchase unless Paddle gives the period end.
  assert.equal(goldenFields(txnOf(['pri_year']), ids).plaidUntil, '2027-11-20');
  assert.equal(goldenFields(txnOf(['pri_year'], { billingPeriod: { endsAt: '2027-11-22T00:00:00Z' } }), ids).plaidUntil, '2027-11-22');
  assert.equal(goldenFields(txnOf(['pri_other']), ids), null);
  assert.throws(() => goldenFields({ id: 't', items: [{ price: { id: 'pri_core' } }] }, ids), /no date/);
});

function setup(over = {}) {
  const store = new MemoryStore();
  const sent = [];
  const paddle = new Paddle('test_key_not_used', { environment: Environment.sandbox });
  const cfg = {
    paddleWebhookSecret: SECRET, sessionSecret: 's', site: 'https://turtlebox.studio', pastDuePolicy: 'grant',
    goldenPriceId: 'pri_golden', goldenPlaidPriceId: 'pri_golden_plaid', goldenSigningKey: SEED, opsEmail: 'ops@example.com', ...over,
  };
  const sendEmail = async (m) => sent.push(m);
  const golden = makeGoldenFulfillment({ cfg, store, paddle, sendEmail, log: () => {} });
  const app = makeApp({ cfg, store, paddle, sendEmail, onPurchase: golden });
  const deliver = (payload) => { const b = JSON.stringify(payload); return app(webhookEvent(b, sign(b))); };
  return { store, sent, deliver };
}

const tokenIn = (mail) => mail.text.match(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/m)[0];

test('a Golden purchase emails a token the app accepts, once', async () => {
  const s = setup();
  await s.deliver(customerEvent('customer.created'));
  const evt = transactionCompletedEvent({ priceId: 'pri_golden' });
  assert.equal((await s.deliver(evt)).statusCode, 200);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].to, 'Buyer@Example.com');
  const payload = JSON.parse(Buffer.from(tokenIn(s.sent[0]).split('.')[0], 'base64url'));
  assert.equal(payload.product, 'golden');
  assert.equal(payload.buyer, 'ctm_01');
  assert.equal(payload.issued, '2026-11-15');
  assert.equal(payload.plaid_until, null);
  await s.deliver(evt); // Paddle redelivers
  assert.equal(s.sent.length, 1);
});

test('a Plaid add-on carries its paid-through date', async () => {
  const s = setup();
  await s.deliver(customerEvent('customer.created'));
  await s.deliver(transactionCompletedEvent({ id: 'txn_p', priceId: 'pri_golden_plaid' }));
  const payload = JSON.parse(Buffer.from(tokenIn(s.sent[0]).split('.')[0], 'base64url'));
  assert.equal(payload.plaid_until, '2026-12-15');
  assert.match(s.sent[0].subject, /renewed/);
});

test('other purchases (Backer, CeeVee) are left alone', async () => {
  const s = setup();
  await s.deliver(customerEvent('customer.created'));
  await s.deliver(transactionCompletedEvent({ priceId: 'pri_backer' }));
  assert.equal(s.sent.length, 0);
});

test('without a signing key the order goes to support and stays replayable', async () => {
  const s = setup({ goldenSigningKey: '' });
  await s.deliver(customerEvent('customer.created'));
  const evt = transactionCompletedEvent({ priceId: 'pri_golden' });
  await s.deliver(evt);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].to, 'ops@example.com');
  assert.match(s.sent[0].subject, /signing key not configured/);
});

test('a failed email releases the claim so Paddle retries', async () => {
  const store = new MemoryStore();
  const paddle = new Paddle('test_key_not_used', { environment: Environment.sandbox });
  await store.upsertCustomer({ customer_id: 'ctm_01', email: 'b@x.test', email_lc: 'b@x.test' }, '2026-11-15T10:00:00Z');
  let fail = true;
  const sent = [];
  const sendEmail = async (m) => { if (fail) throw new Error('ses down'); sent.push(m); };
  const run = makeGoldenFulfillment({ cfg: { goldenPriceId: 'pri_golden', goldenSigningKey: SEED }, store, paddle, sendEmail, log: () => {} });
  const txn = { id: 'txn_r', customerId: 'ctm_01', billedAt: '2026-11-20T00:00:00Z', items: [{ price: { id: 'pri_golden' }, quantity: 1 }] };
  await assert.rejects(run(txn), /ses down/);
  fail = false;
  await run(txn);
  assert.equal(sent.length, 1);
});

test('the email has an Activate button, a copyable key and a plain-text fallback', async () => {
  const s = setup();
  await s.deliver(customerEvent('customer.created'));
  await s.deliver(transactionCompletedEvent({ priceId: 'pri_golden' }));
  const token = tokenIn(s.sent[0]);
  assert.ok(s.sent[0].text.includes(`https://turtlebox.studio/golden/activate/#key=${token}`));
  assert.ok(s.sent[0].html.includes(`href="https://turtlebox.studio/golden/activate/#key=${token}"`));
  assert.match(s.sent[0].html, />Activate Golden</);
  assert.ok(s.sent[0].html.includes(token), 'the key is shown for copying');
});

test('an annual Plaid purchase carries a year, and a renewal is a fresh key with a later date', async () => {
  const s = setup({ goldenPlaidYearlyPriceId: 'pri_golden_year' });
  await s.deliver(customerEvent('customer.created'));
  await s.deliver(transactionCompletedEvent({ id: 'txn_y1', priceId: 'pri_golden_year' }));
  await s.deliver(transactionCompletedEvent({ id: 'txn_y2', priceId: 'pri_golden_plaid' }));
  assert.equal(s.sent.length, 2);
  const dates = s.sent.map((m) => JSON.parse(Buffer.from(tokenIn(m).split('.')[0], 'base64url')).plaid_until);
  assert.equal(dates[0], '2027-11-15');
  assert.equal(dates[1], '2026-12-15');
  assert.notEqual(tokenIn(s.sent[0]), tokenIn(s.sent[1]));
  for (const m of s.sent) assert.ok(m.text.includes('/golden/activate/#key=') && m.html.includes('/golden/activate/#key='));
});

test('core plus the annual add-on in one checkout sends one email with both', async () => {
  const s = setup({ goldenPlaidYearlyPriceId: 'pri_golden_year' });
  await s.deliver(customerEvent('customer.created'));
  const evt = transactionCompletedEvent({ id: 'txn_b', priceId: 'pri_golden' });
  evt.data.items.push({ ...evt.data.items[0], price: { ...evt.data.items[0].price, id: 'pri_golden_year' } });
  await s.deliver(evt);
  assert.equal(s.sent.length, 1);
  const p = JSON.parse(Buffer.from(tokenIn(s.sent[0]).split('.')[0], 'base64url'));
  assert.equal(p.plaid_until, '2027-11-15');
});
