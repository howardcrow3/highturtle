import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { makeApp } from '../src/handler.mjs';
import { MemoryStore, buildUpsert } from '../src/store.mjs';
import { subscriptionGrantsAccess, anySubscriptionGrantsAccess } from '../src/access.mjs';
import { signToken, verifyToken } from '../src/session.mjs';
import { CeeveeMemoryStore } from '../src/ceevee-store.mjs';
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
  return { app, store, sent, portalCalls, deliver, cfg, appPaddle: paddle };
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

function idToken(claims) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256' })}.${b(claims)}.sig`;
}

function googleSetup(claimsFor) {
  const ctx = setup({ googleClientId: 'cid.apps.googleusercontent.com', googleClientSecret: 'gsecret', backerPriceIds: ['pri_backer'] });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: String(init.body) });
    return { ok: true, json: async () => ({ id_token: idToken(claimsFor(calls.length)) }) };
  };
  const app = makeApp({ cfg: ctx.cfg, store: ctx.store, paddle: ctx.appPaddle, sendEmail: async () => {}, fetchImpl });
  return { ...ctx, app, calls };
}

async function googleSignIn(app, claims) {
  const r1 = await app(req('GET', '/api/billing/google/start'));
  const loc = new URL(r1.headers.location);
  assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://turtlebox.studio/api/billing/google/callback');
  const state = loc.searchParams.get('state');
  const nonce = loc.searchParams.get('nonce');
  const oauthCookie = r1.cookies[0].split(';')[0];
  claims.nonce = claims.nonce ?? nonce;
  const r2 = await app(req('GET', '/api/billing/google/callback', { queryStringParameters: { state, code: 'abc' }, cookies: [oauthCookie] }));
  return r2;
}

const goodClaims = () => ({ iss: 'https://accounts.google.com', aud: 'cid.apps.googleusercontent.com',
  exp: Math.floor(Date.now() / 1000) + 300, email: 'Buyer@Example.com', email_verified: true,
  name: 'Bea Buyer', picture: 'https://lh3.googleusercontent.com/a/x' });

test('Google sign-in, then purchases, access and the portal for the matching Paddle customer', async () => {
  let claims;
  const g = googleSetup(() => claims);
  await g.deliver(customerEvent('customer.created'));
  await g.deliver(subscriptionEvent('subscription.created'));
  await g.deliver(transactionCompletedEvent());
  claims = goodClaims();
  const r = await googleSignIn(g.app, claims);
  assert.equal(r.headers.location, 'https://turtlebox.studio/account/');
  assert.match(g.calls[0].body, /client_secret=gsecret/);
  const cookie = r.cookies.find((c) => c.startsWith('tb_account=') && !c.startsWith('tb_account=;')).split(';')[0];

  const me = JSON.parse((await g.app(req('GET', '/api/billing/me', { cookies: [cookie] }))).body);
  assert.equal(me.signedIn, true);
  assert.equal(me.customer, true);
  assert.equal(me.access, true);
  assert.equal(me.purchases.length, 1);
  assert.equal(me.purchases[0].backer, true);
  assert.equal(me.name, 'Bea Buyer');
  assert.equal(me.picture, 'https://lh3.googleusercontent.com/a/x');

  const p = await g.app(req('POST', '/api/billing/portal', { cookies: [cookie] }));
  assert.equal(p.headers.location, 'https://customer-portal.paddle.com/cpl_x?c=ctm_01');
});

test('Google sign-in with no purchases signs in but shows no customer', async () => {
  let claims;
  const g = googleSetup(() => claims);
  claims = { ...goodClaims(), email: 'new@example.com' };
  const r = await googleSignIn(g.app, claims);
  const cookie = r.cookies.find((c) => c.startsWith('tb_account=')).split(';')[0];
  const me = JSON.parse((await g.app(req('GET', '/api/billing/me', { cookies: [cookie] }))).body);
  assert.deepEqual([me.signedIn, me.customer, me.purchases.length], [true, false, 0]);
  const p = await g.app(req('POST', '/api/billing/portal', { cookies: [cookie] }));
  assert.match(p.headers.location, /error=signin/);
});

for (const [name, mutate] of [
  ['unverified email', (c) => { c.email_verified = false; }],
  ['wrong audience', (c) => { c.aud = 'someone-else'; }],
  ['wrong issuer', (c) => { c.iss = 'https://evil.example'; }],
  ['expired token', (c) => { c.exp = 1; }],
  ['wrong nonce', (c) => { c.nonce = 'replayed'; }],
]) {
  test(`Google sign-in is refused: ${name}`, async () => {
    let claims;
    const g = googleSetup(() => claims);
    claims = goodClaims(); mutate(claims);
    const r = await googleSignIn(g.app, claims);
    assert.match(r.headers.location, /error=signin/);
    assert.ok(!r.cookies.some((c) => c.startsWith('tb_account=') && !c.startsWith('tb_account=;')));
  });
}

test('Google callback with a state that does not match the cookie is refused', async () => {
  const g = googleSetup(() => goodClaims());
  const r1 = await g.app(req('GET', '/api/billing/google/start'));
  const oauthCookie = r1.cookies[0].split(';')[0];
  const r2 = await g.app(req('GET', '/api/billing/google/callback', { queryStringParameters: { state: 'forged', code: 'abc' }, cookies: [oauthCookie] }));
  assert.match(r2.headers.location, /error=signin/);
  assert.equal(g.calls.length, 0);
});

test('Google start without a configured client says sign-in is unavailable', async () => {
  const { app } = setup();
  const r = await app(req('GET', '/api/billing/google/start'));
  assert.match(r.headers.location, /error=unavailable/);
});

test('a forged session cookie is refused', async () => {
  const { app, portalCalls } = setup();
  const forged = signToken('not-the-secret', 'session', { e: 'buyer@example.com' }, 3600);
  const res = await app(req('POST', '/api/billing/portal', { cookies: [`tb_account=${forged}`] }));
  assert.match(res.headers.location, /error=signin/);
  assert.equal(portalCalls.length, 0);
});

// ---------- Backer license fulfillment ----------

import { issueKey } from '../src/license.mjs';
import { makeBackerFulfillment } from '../src/fulfillment.mjs';

const SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

test('license key matches the Backer issuer byte for byte', async () => {
  // Expected value produced by howardcrow3/Backer tools/key-issuer/issuer.mjs with the same inputs.
  assert.equal(await issueKey(SEED, 'Buyer@Example.com', 20400),
    'BACKER-AEAQC-AAAJ6-YBCYT-VPFSX-EQDFP-BQW24-DMMUX-GG33N-TQRKL-H6VFD-ZADH5-S7AZ3-YTCFE-OFTDY-2L7FV-NK75X-3ZDEJ-5NAZE-CLQZR-S5YQT-KC3DP-2FULK-SDXVP-GJGNH-F7I5O-JKFE5-UNKXW-C6R2I-4AY');
});

function backerSetup({ signingKey = SEED, failSend = false } = {}) {
  const store = new MemoryStore();
  const sent = [];
  const paddle = new Paddle('k', { environment: Environment.sandbox });
  paddle.customers.get = async (id) => ({ id, email: 'late@example.com' });
  const cfg = { paddleWebhookSecret: SECRET, sessionSecret: 's', site: 'https://turtlebox.studio',
    backerPriceIds: ['pri_backer'], backerSigningKey: signingKey, opsEmail: 'info@turtlebox.studio' };
  let fail = failSend;
  const sendEmail = async (m) => { if (fail) { fail = false; throw new Error('ses down'); } sent.push(m); };
  const onPurchase = makeBackerFulfillment({ cfg, store, paddle, sendEmail, log: () => {} });
  const app = makeApp({ cfg, store, paddle, sendEmail, onPurchase });
  const deliver = (payload) => { const body = JSON.stringify(payload); return app(webhookEvent(body, sign(body))); };
  return { store, sent, deliver, app, cfg };
}

test('a Backer purchase emails one valid key, once, even when delivered twice', async () => {
  const { deliver, sent, store } = backerSetup();
  await deliver(customerEvent('customer.created'));
  const ev = transactionCompletedEvent();
  assert.equal((await deliver(ev)).statusCode, 200);
  assert.equal((await deliver(ev)).statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'Buyer@Example.com');
  assert.match(sent[0].text, /BACKER-[A-Z2-7-]+/);
  assert.equal(store.transactions.get('txn_01').fulfillment_status, 'emailed');
  assert.deepEqual(store.transactions.get('txn_01').license_keys, [sent[0].text.match(/BACKER-[A-Z2-7-]+/)[0]]);
});

test('the profile shows Google name and avatar, orders, the stored Backer key and CeeVee licenses', async () => {
  const { deliver, sent, store, cfg } = backerSetup();
  await deliver(customerEvent('customer.created'));
  await deliver(transactionCompletedEvent());
  const ceevee = new CeeveeMemoryStore();
  await ceevee.createLicense({ license_key: 'CEEVEE-AAAAA', email: 'Buyer@example.com', transaction_id: 'txn_x', seats: 3, major: 1 });
  const app = makeApp({ cfg, store, paddle: null, sendEmail: async () => {}, ceevee });
  const tok = signToken(cfg.sessionSecret, 'session', { e: 'buyer@example.com', n: 'Bea Buyer', p: 'https://lh3.googleusercontent.com/a/x' }, 3600);
  const me = JSON.parse((await app(req('GET', '/api/billing/me', { cookies: [`tb_account=${tok}`] }))).body);
  assert.equal(me.name, 'Bea Buyer');
  assert.equal(me.picture, 'https://lh3.googleusercontent.com/a/x');
  assert.equal(me.purchases.length, 1);
  assert.equal(me.purchases[0].product, 'Backer');
  const key = sent[0].text.match(/BACKER-[A-Z2-7-]+/)[0];
  assert.deepEqual(me.licenses.map((l) => [l.product, l.key]), [['Backer', key], ['CeeVee', 'CEEVEE-AAAAA']]);
  assert.equal(me.licenses[1].seats, 3);
});

test('a signed-in visitor with no Paddle customer still sees their CeeVee licenses', async () => {
  const { store, cfg } = backerSetup();
  const ceevee = new CeeveeMemoryStore();
  await ceevee.createLicense({ license_key: 'CEEVEE-BBBBB', email: 'solo@example.com', transaction_id: 'txn_y', seats: 1, major: 1 });
  const app = makeApp({ cfg, store, paddle: null, sendEmail: async () => {}, ceevee });
  const tok = signToken(cfg.sessionSecret, 'session', { e: 'solo@example.com' }, 3600);
  const me = JSON.parse((await app(req('GET', '/api/billing/me', { cookies: [`tb_account=${tok}`] }))).body);
  assert.equal(me.customer, false);
  assert.deepEqual(me.licenses.map((l) => l.key), ['CEEVEE-BBBBB']);
});

test('buyer email comes from Paddle when customer.created has not arrived yet', async () => {
  const { deliver, sent } = backerSetup();
  await deliver(transactionCompletedEvent());
  assert.equal(sent[0].to, 'late@example.com');
});

test('a failed email releases the claim and returns 500 so Paddle retries', async () => {
  const { deliver, sent, store } = backerSetup({ failSend: true });
  await deliver(customerEvent('customer.created'));
  assert.equal((await deliver(transactionCompletedEvent())).statusCode, 500);
  assert.equal(store.transactions.get('txn_01').fulfillment_status, undefined);
  assert.equal((await deliver(transactionCompletedEvent())).statusCode, 200);
  assert.equal(sent.length, 1);
});

test('without a signing key the order goes to the support inbox instead', async () => {
  const { deliver, sent, store } = backerSetup({ signingKey: '' });
  await deliver(customerEvent('customer.created'));
  await deliver(transactionCompletedEvent());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'info@turtlebox.studio');
  assert.match(sent[0].subject, /issue a license key by hand/);
  assert.equal(store.transactions.get('txn_01').fulfillment_status, 'manual');
});

test('purchases of other prices send nothing', async () => {
  const { deliver, sent } = backerSetup();
  const ev = transactionCompletedEvent();
  ev.data.items[0].price.id = 'pri_other';
  await deliver(ev);
  assert.equal(sent.length, 0);
});
