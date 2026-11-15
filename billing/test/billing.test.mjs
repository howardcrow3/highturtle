import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { makeApp } from '../src/handler.mjs';
import { MemoryStore, buildUpsert } from '../src/store.mjs';
import { subscriptionGrantsAccess, anySubscriptionGrantsAccess } from '../src/access.mjs';
import { signToken, verifyToken } from '../src/session.mjs';
import { SECRET, sign, webhookEvent, customerEvent, subscriptionEvent, transactionCompletedEvent } from './fixtures.mjs';

function setup(overrides = {}) {
  const store = new MemoryStore();
  const sent = [];
  const portalCalls = [];
  const paddle = new Paddle('test_key_not_used', { environment: Environment.sandbox });
  paddle.customerPortalSessions.create = async (customerId, subIds) => {
    portalCalls.push({ customerId, subIds });
    return { urls: { general: { overview: `https://customer-portal.paddle.com/cpl_x?c=${customerId}` } } };
  };
  const cfg = {
    paddleWebhookSecret: SECRET, sessionSecret: 'session-secret-for-tests', site: 'https://turtlebox.studio',
    pastDuePolicy: 'grant', ...overrides,
  };
  const app = makeApp({ cfg, store, paddle, sendEmail: async (m) => sent.push(m) });
  const deliver = (payload, opts = {}) => {
    const body = JSON.stringify(payload);
    return app(webhookEvent(body, opts.signature ?? sign(body), opts));
  };
  return { app, store, sent, portalCalls, deliver, cfg };
}

// ---------- Part 1: webhook verification and routing ----------

test('valid signature is accepted and the customer is mirrored', async () => {
  const { deliver, store } = setup();
  const res = await deliver(customerEvent('customer.created'));
  assert.equal(res.statusCode, 200);
  const c = await store.getCustomer('ctm_01');
  assert.equal(c.email, 'Buyer@Example.com');
  assert.equal(c.email_lc, 'buyer@example.com');
});

test('base64-encoded body from the function URL still verifies', async () => {
  const { deliver } = setup();
  const res = await deliver(customerEvent('customer.created'), { base64: true });
  assert.equal(res.statusCode, 200);
});

test('bad signature is rejected with a non-2xx and nothing is written', async () => {
  const { deliver, store } = setup();
  const payload = customerEvent('customer.created');
  const res = await deliver(payload, { signature: sign(JSON.stringify(payload), 'wrong-secret') });
  assert.equal(res.statusCode, 401);
  assert.equal(await store.getCustomer('ctm_01'), null);
});

test('a re-serialised (parsed then stringified) body fails verification', async () => {
  const { app } = setup();
  const original = JSON.stringify(customerEvent('customer.created'), null, 2);
  const reserialised = JSON.stringify(JSON.parse(original));
  const res = await app(webhookEvent(reserialised, sign(original)));
  assert.equal(res.statusCode, 401);
});

test('missing signature header is rejected', async () => {
  const { app } = setup();
  const res = await app(webhookEvent(JSON.stringify(customerEvent('customer.created')), null));
  assert.equal(res.statusCode, 400);
});

test('old timestamp (replay) is rejected', async () => {
  const { app } = setup();
  const body = JSON.stringify(customerEvent('customer.created'));
  const res = await app(webhookEvent(body, sign(body, SECRET, Math.floor(Date.now() / 1000) - 600)));
  assert.equal(res.statusCode, 401);
});

test('missing webhook secret returns 500 so Paddle retries', async () => {
  const { deliver } = setup({ paddleWebhookSecret: '' });
  const res = await deliver(customerEvent('customer.created'));
  assert.equal(res.statusCode, 500);
});

test('unhandled event types are acknowledged and ignored', async () => {
  const { deliver } = setup();
  const res = await deliver({ event_id: 'evt_x', event_type: 'product.updated', occurred_at: '2026-11-15T10:00:00Z',
    data: { id: 'pro_1', name: 'x', tax_category: 'standard', description: null, type: 'standard', image_url: null,
      custom_data: null, status: 'active', import_meta: null, created_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z' } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).result, 'ignored');
});

test('a handler failure returns 500 so Paddle retries', async () => {
  const { deliver, store } = setup();
  store.upsertCustomer = async () => { throw new Error('db down'); };
  const res = await deliver(customerEvent('customer.created'));
  assert.equal(res.statusCode, 500);
});

// ---------- Part 2: mirror, idempotency, ordering ----------

test('redelivery of the same event is idempotent', async () => {
  const { deliver, store } = setup();
  const ev = subscriptionEvent('subscription.created');
  await deliver(ev);
  await deliver(ev);
  assert.equal(store.subscriptions.size, 1);
  assert.equal((await store.listSubscriptions('ctm_01'))[0].status, 'active');
});

test('an older event arriving late does not overwrite newer state', async () => {
  const { deliver, store } = setup();
  await deliver(subscriptionEvent('subscription.canceled', { status: 'canceled', updated: '2026-11-15T12:00:00.000000Z' }));
  const res = await deliver(subscriptionEvent('subscription.updated', { status: 'active', updated: '2026-11-15T11:00:00.000000Z' }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).result, 'stale');
  assert.equal(store.subscriptions.get('sub_01').status, 'canceled');
});

test('subscription row carries price, product and scheduled change', async () => {
  const { deliver, store } = setup();
  await deliver(subscriptionEvent('subscription.updated', {
    scheduledChange: { action: 'cancel', effective_at: '2026-12-15T09:00:00Z', resume_at: null },
  }));
  const s = store.subscriptions.get('sub_01');
  assert.equal(s.price_id, 'pri_monthly');
  assert.equal(s.product_id, 'pro_pro');
  assert.equal(s.scheduled_change_action, 'cancel');
  assert.equal(s.scheduled_change_at, '2026-12-15T09:00:00Z');
  // Removing the scheduled change later clears the columns.
  await deliver(subscriptionEvent('subscription.updated', { updated: '2026-11-15T13:00:00.000000Z' }));
  assert.equal(store.subscriptions.get('sub_01').scheduled_change_action, undefined);
});

test('transaction.completed is mirrored and calls the purchase hook', async () => {
  const store = new MemoryStore();
  const purchases = [];
  const paddle = new Paddle('k', { environment: Environment.sandbox });
  const app = makeApp({ cfg: { paddleWebhookSecret: SECRET, sessionSecret: 's', site: 'https://x' }, store, paddle,
    sendEmail: async () => {}, onPurchase: async (t) => purchases.push(t.id) });
  const body = JSON.stringify(transactionCompletedEvent());
  const res = await app(webhookEvent(body, sign(body)));
  assert.equal(res.statusCode, 200);
  assert.equal(store.transactions.get('txn_01').items[0].product_id, 'pro_backer');
  assert.deepEqual(purchases, ['txn_01']);
});

test('DynamoDB upsert is conditional on the Paddle version and never deletes', () => {
  const req = buildUpsert('t', 'subscription_id', 'sub_01', { subscription_id: 'sub_01', status: 'active', scheduled_change_at: null }, 'v2');
  assert.equal(req.ConditionExpression, 'attribute_not_exists(#pk) OR #v <= :v');
  assert.match(req.UpdateExpression, /^SET .* REMOVE #f1$/);
  assert.equal(req.ExpressionAttributeValues[':v'], 'v2');
  const fieldNames = Object.entries(req.ExpressionAttributeNames).filter(([k]) => k.startsWith('#f')).map(([, v]) => v);
  assert.ok(!fieldNames.includes('subscription_id'), 'the key is never rewritten');
  assert.doesNotMatch(req.UpdateExpression, /DELETE/);
});

// ---------- Access helper ----------

test('active and trialing grant access; canceled and paused do not', () => {
  assert.equal(subscriptionGrantsAccess({ status: 'active' }), true);
  assert.equal(subscriptionGrantsAccess({ status: 'trialing' }), true);
  assert.equal(subscriptionGrantsAccess({ status: 'canceled' }), false);
  assert.equal(subscriptionGrantsAccess({ status: 'paused' }), false);
  assert.equal(subscriptionGrantsAccess(null), false);
});

test('a scheduled cancel or pause does not revoke access on its own', () => {
  assert.equal(subscriptionGrantsAccess({ status: 'active', scheduled_change_action: 'cancel' }), true);
  assert.equal(subscriptionGrantsAccess({ status: 'trialing', scheduled_change_action: 'pause' }), true);
});

test('past_due follows the configured policy', () => {
  assert.equal(subscriptionGrantsAccess({ status: 'past_due' }), true);
  assert.equal(subscriptionGrantsAccess({ status: 'past_due' }, { pastDuePolicy: 'deny' }), false);
});

test('product filter for tiers', () => {
  const subs = [{ status: 'active', product_id: 'pro_basic' }, { status: 'canceled', product_id: 'pro_max' }];
  assert.equal(anySubscriptionGrantsAccess(subs, { productIds: ['pro_basic'] }), true);
  assert.equal(anySubscriptionGrantsAccess(subs, { productIds: ['pro_max'] }), false);
});

// ---------- Part 3: sign-in and portal ----------

const req = (method, path, extra = {}) => ({ rawPath: path, requestContext: { http: { method } }, headers: {}, ...extra });

test('tokens are signed per purpose and expire', () => {
  const t = signToken('s', 'login', { e: 'a@b.c' }, 60);
  assert.equal(verifyToken('s', 'login', t).e, 'a@b.c');
  assert.equal(verifyToken('s', 'session', t), null);
  assert.equal(verifyToken('other', 'login', t), null);
  assert.equal(verifyToken('s', 'login', t, Date.now() + 120_000), null);
});

test('portal refuses without a session and never calls Paddle', async () => {
  const { app, portalCalls } = setup();
  const res = await app(req('POST', '/api/billing/portal'));
  assert.equal(res.statusCode, 303);
  assert.match(res.headers.location, /error=signin/);
  assert.equal(portalCalls.length, 0);
});

test('portal ignores a customer ID supplied by the client', async () => {
  const { app, deliver, portalCalls } = setup();
  await deliver(customerEvent('customer.created', { id: 'ctm_victim', email: 'victim@example.com' }));
  const res = await app(req('POST', '/api/billing/portal', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'customer_id=ctm_victim',
  }));
  assert.match(res.headers.location, /error=signin/);
  assert.equal(portalCalls.length, 0);
});

test('full flow: sign-in email, link, session cookie, portal redirect', async () => {
  const { app, deliver, sent, portalCalls } = setup();
  await deliver(customerEvent('customer.created'));
  await deliver(subscriptionEvent('subscription.created'));
  await deliver(subscriptionEvent('subscription.created', { id: 'sub_old', status: 'canceled' }));

  const r1 = await app(req('POST', '/api/billing/signin', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=buyer%40example.com',
  }));
  assert.match(r1.headers.location, /sent=1/);
  assert.equal(sent.length, 1);
  const link = sent[0].text.match(/https:\/\/\S+/)[0];
  const t = new URL(link).searchParams.get('t');

  const r2 = await app(req('GET', '/api/billing/auth', { queryStringParameters: { t } }));
  assert.equal(r2.statusCode, 303);
  const cookie = r2.cookies[0].split(';')[0];
  assert.match(r2.cookies[0], /HttpOnly; Secure; SameSite=Lax/);

  const r3 = await app(req('GET', '/api/billing/me', { cookies: [cookie] }));
  const me = JSON.parse(r3.body);
  assert.equal(me.signedIn, true);
  assert.equal(me.access, true);

  const r4 = await app(req('POST', '/api/billing/portal', { cookies: [cookie] }));
  assert.equal(r4.statusCode, 303);
  assert.equal(r4.headers.location, 'https://customer-portal.paddle.com/cpl_x?c=ctm_01');
  assert.deepEqual(portalCalls, [{ customerId: 'ctm_01', subIds: ['sub_01'] }]);
});

test('sign-in for an unknown email sends nothing but answers the same', async () => {
  const { app, sent } = setup();
  const res = await app(req('POST', '/api/billing/signin', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=nobody%40example.com',
  }));
  assert.match(res.headers.location, /sent=1/);
  assert.equal(sent.length, 0);
});

test('a forged session cookie is refused', async () => {
  const { app, portalCalls } = setup();
  const forged = signToken('not-the-secret', 'session', { c: 'ctm_01' }, 3600);
  const res = await app(req('POST', '/api/billing/portal', { cookies: [`tb_account=${forged}`] }));
  assert.match(res.headers.location, /error=signin/);
  assert.equal(portalCalls.length, 0);
});
