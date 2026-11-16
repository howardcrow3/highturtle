// Turtlebox billing: Paddle webhooks, the subscription mirror, and the customer portal.
//
// One Lambda behind a function URL, reached through CloudFront at /api/billing/*.
//   POST /api/billing/webhook   Paddle notification destination. Verifies the signature first.
//   GET  /api/billing/google/start      sends the visitor to Google sign-in
//   GET  /api/billing/google/callback   checks Google's answer, sets the session cookie, goes to /account/
//   GET  /api/billing/me        JSON: signed in?, email, access, subscriptions, purchases (account page)
//   POST /api/billing/portal    signed-in only: mints a Paddle customer portal session, 303 to it
//   POST /api/billing/signout   clears the session cookie

import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { loadConfig } from './config.mjs';
import { DynamoStore } from './store.mjs';
import { routeEvent } from './events.mjs';
import { makeBackerFulfillment } from './fulfillment.mjs';
import { makeCeeveeFulfillment } from './ceevee-fulfillment.mjs';
import { makeCeeveeApi, isCeeveePath } from './ceevee-api.mjs';
import { CeeveeDynamoStore } from './ceevee-store.mjs';
import { anySubscriptionGrantsAccess, subscriptionGrantsAccess } from './access.mjs';
import { signToken, verifyToken, sessionCookie, readCookie, SESSION_TTL, COOKIE } from './session.mjs';
import { authUrl, exchangeCode, newNonce } from './google.mjs';

const OAUTH_TTL = 10 * 60;

const log = (fields) => console.log(JSON.stringify(fields));

function respond(status, body = '', headers = {}, cookies) {
  const out = { statusCode: status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }, body };
  if (cookies) out.cookies = cookies;
  return out;
}
const json = (status, obj, cookies) => respond(status, JSON.stringify(obj), {}, cookies);
const redirect = (url, cookies) => respond(303, '', { location: url }, cookies);

// The exact bytes Paddle signed. Never JSON.parse before verifying.
export function rawBody(event) {
  const body = event.body || '';
  return event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
}

function header(event, name) {
  const h = event.headers || {};
  return h[name] ?? h[name.toLowerCase()] ?? Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
}

export function makeApp(deps) {
  const { cfg, store, paddle, sendEmail } = deps;
  const ceeveeApi = deps.ceevee ? makeCeeveeApi({ cfg, ceevee: deps.ceevee, log, now: deps.now }) : null;

  async function webhook(event) {
    const signature = header(event, 'paddle-signature');
    if (!signature) return json(400, { error: 'missing signature' });
    if (!cfg.paddleWebhookSecret) {
      log({ error: 'PADDLE_WEBHOOK_SECRET is not set' });
      return json(500, { error: 'not configured' }); // not 2xx, so Paddle keeps retrying
    }
    let verified;
    try {
      verified = await paddle.webhooks.unmarshal(rawBody(event), cfg.paddleWebhookSecret, signature);
    } catch (err) {
      log({ warn: 'webhook verification failed', message: String(err?.message || err) });
      return json(401, { error: 'invalid signature' });
    }
    if (!verified) return json(401, { error: 'invalid signature' });
    try {
      const result = await routeEvent(verified, { store, log, onPurchase: deps.onPurchase });
      return json(200, { ok: true, result });
    } catch (err) {
      log({ error: 'webhook handler failed', event: verified.eventType, id: verified.eventId, message: String(err?.message || err) });
      return json(500, { error: 'handler failed' }); // Paddle retries
    }
  }

  const redirectUri = `${cfg.site}/api/billing/google/callback`;
  const stateCookie = (v, maxAge) => `tb_oauth=${v}; Path=/api/billing/google; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

  function googleStart() {
    if (!cfg.googleClientId || !cfg.googleClientSecret) return redirect(`${cfg.site}/account/?error=unavailable`);
    const state = newNonce();
    const nonce = newNonce();
    const signed = signToken(cfg.sessionSecret, 'oauth', { s: state, n: nonce }, OAUTH_TTL);
    return redirect(authUrl({ clientId: cfg.googleClientId, redirectUri, state, nonce }), [stateCookie(signed, OAUTH_TTL)]);
  }

  async function googleCallback(event) {
    const q = event.queryStringParameters || {};
    const clear = stateCookie('', 0);
    const saved = verifyToken(cfg.sessionSecret, 'oauth', readCookie(event, 'tb_oauth'));
    if (!saved || !q.state || q.state !== saved.s || !q.code) return redirect(`${cfg.site}/account/?error=signin`, [clear]);
    let profile;
    try {
      profile = await exchangeCode({ code: q.code, clientId: cfg.googleClientId, clientSecret: cfg.googleClientSecret,
        redirectUri, nonce: saved.n, fetchImpl: deps.fetchImpl });
    } catch (err) {
      log({ warn: 'google sign-in failed', message: String(err?.message || err) });
      return redirect(`${cfg.site}/account/?error=signin`, [clear]);
    }
    // The session holds the Google-verified email (plus name and avatar for the header). The Paddle customer
    // is looked up from the email, server-side, on every request, so purchases made after signing in show up too.
    const session = signToken(cfg.sessionSecret, 'session', { e: profile.email, n: profile.name, p: profile.picture }, SESSION_TTL);
    return redirect(`${cfg.site}/account/`, [clear, sessionCookie(session, SESSION_TTL)]);
  }

  function sessionData(event) {
    const s = verifyToken(cfg.sessionSecret, 'session', readCookie(event, COOKIE));
    return s?.e ? s : null;
  }
  const sessionEmail = (event) => sessionData(event)?.e || null;

  // CeeVee licenses are keyed by email, so they show even before a Paddle customer row exists.
  async function ceeveeLicenses(email) {
    if (!deps.ceevee?.findLicensesByEmail) return [];
    const rows = await deps.ceevee.findLicensesByEmail(email).catch((err) => {
      log({ warn: 'ceevee licenses unavailable', message: String(err?.message || err) });
      return [];
    });
    return rows.map((l) => ({
      product: 'CeeVee', key: l.license_key, status: l.status ?? 'active', seats: l.seats ?? null,
      seats_used: Object.keys(l.machines || {}).length, version: l.major ? `${l.major}.x` : null,
      date: l.created_at ?? l.issued_at ?? null,
    }));
  }

  async function currentCustomer(event) {
    const email = sessionEmail(event);
    return email ? store.findCustomerByEmail(email) : null;
  }

  async function me(event) {
    const sess = sessionData(event);
    if (!sess) return json(200, { signedIn: false });
    const email = sess.e;
    const profile = { signedIn: true, email, name: sess.n || null, picture: sess.p || null };
    const [customer, ceeveeKeys] = await Promise.all([store.findCustomerByEmail(email), ceeveeLicenses(email)]);
    if (!customer) return json(200, { ...profile, customer: false, access: false, subscriptions: [], purchases: [], licenses: ceeveeKeys });
    const subs = await store.listSubscriptions(customer.customer_id);
    const txns = await store.listTransactions(customer.customer_id).catch((err) => {
      log({ warn: 'purchases unavailable', message: String(err?.message || err) });
      return [];
    });
    const backerPrices = cfg.backerPriceIds || [];
    const paid = txns
      .filter((t) => t.status === 'completed' || t.status === 'paid')
      .sort((a, b) => String(b.billed_at || b.paddle_created_at).localeCompare(String(a.billed_at || a.paddle_created_at)));
    const isBacker = (t) => (t.items || []).some((i) => backerPrices.includes(i.price_id));
    const isCeevee = (t) => !!t.ceevee_fulfillment_status;
    const backerKeys = paid.filter(isBacker).flatMap((t) => (t.license_keys || []).map((key) => ({
      product: 'Backer', key, status: 'active', version: '1.x', date: t.billed_at || t.paddle_created_at,
      invoice_number: t.invoice_number ?? null,
    })));
    return json(200, {
      ...profile,
      customer: true,
      licenses: [...backerKeys, ...ceeveeKeys],
      purchases: paid.map((t) => ({
        date: t.billed_at || t.paddle_created_at,
        invoice_number: t.invoice_number ?? null,
        product: isBacker(t) ? 'Backer' : isCeevee(t) ? 'CeeVee' : null,
        backer: isBacker(t),
        license_status: t.fulfillment_status ?? t.ceevee_fulfillment_status ?? null,
        total: t.total ?? null,
        currency: t.currency_code ?? null,
      })),
      access: anySubscriptionGrantsAccess(subs, { pastDuePolicy: cfg.pastDuePolicy }),
      subscriptions: subs.map((s) => ({
        status: s.status,
        product_id: s.product_id,
        price_id: s.price_id,
        grants_access: subscriptionGrantsAccess(s, { pastDuePolicy: cfg.pastDuePolicy }),
        scheduled_change_action: s.scheduled_change_action ?? null,
        scheduled_change_at: s.scheduled_change_at ?? null,
        next_billed_at: s.next_billed_at ?? null,
      })),
    });
  }

  async function portal(event) {
    // 1. Authenticated first. The customer ID comes only from the signed session, never the request.
    const customer = await currentCustomer(event);
    if (!customer) return redirect(`${cfg.site}/account/?error=signin`);
    // 2. Look up their subscriptions so the portal can deep-link each one.
    const subs = await store.listSubscriptions(customer.customer_id);
    const subIds = subs.filter((s) => s.status !== 'canceled').map((s) => s.subscription_id);
    // 3. Mint the Paddle-hosted portal session.
    try {
      const session = await paddle.customerPortalSessions.create(customer.customer_id, subIds);
      return redirect(session.urls.general.overview);
    } catch (err) {
      log({ error: 'portal session failed', customer: customer.customer_id, message: String(err?.message || err) });
      return redirect(`${cfg.site}/account/?error=portal`);
    }
  }

  function signout() {
    return redirect(`${cfg.site}/account/`, [sessionCookie('', 0)]);
  }

  return async function handle(event) {
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const path = (event.rawPath || event.path || '').replace(/\/+$/, '');
    try {
      if (ceeveeApi && isCeeveePath(path)) return await ceeveeApi(event, method, path);
      if (path === '/api/billing/webhook' && method === 'POST') return await webhook(event);
      if (path === '/api/billing/google/start' && method === 'GET') return googleStart();
      if (path === '/api/billing/google/callback' && method === 'GET') return await googleCallback(event);
      if (path === '/api/billing/me' && method === 'GET') return await me(event);
      if (path === '/api/billing/portal' && method === 'POST') return await portal(event);
      if (path === '/api/billing/signout' && method === 'POST') return signout();
      return json(404, { error: 'not found' });
    } catch (err) {
      log({ error: 'unhandled', path, message: String(err?.message || err) });
      return json(500, { error: 'server error' });
    }
  };
}

let app = null;

async function buildApp() {
  const cfg = await loadConfig();
  const paddle = new Paddle(cfg.paddleApiKey, {
    environment: cfg.paddleEnvironment === 'sandbox' ? Environment.sandbox : Environment.production,
  });
  const store = new DynamoStore({ tables: cfg.tables, region: cfg.region });
  const ses = new SESv2Client({ region: cfg.region });
  const sendEmail = ({ to, subject, text }) => ses.send(new SendEmailCommand({
    FromEmailAddress: cfg.fromAddr,
    Destination: { ToAddresses: [to] },
    ReplyToAddresses: cfg.replyTo ? [cfg.replyTo] : undefined,
    ConfigurationSetName: cfg.configSet || undefined,
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
  }));
  const ceevee = new CeeveeDynamoStore({ tables: cfg.tables, region: cfg.region });
  const backer = makeBackerFulfillment({ cfg, store, paddle, sendEmail, log });
  const ceeveeFulfil = makeCeeveeFulfillment({ cfg, store, ceevee, paddle, sendEmail, log });
  // Each hook is idempotent on its own claim, so a retry after one fails is safe.
  const onPurchase = async (txn) => { await backer(txn); await ceeveeFulfil(txn); };
  return makeApp({ cfg, store, paddle, sendEmail, onPurchase, ceevee });
}

export async function handler(event) {
  if (!app) app = await buildApp();
  return app(event);
}
