// Turtlebox billing: Paddle webhooks, the subscription mirror, and the customer portal.
//
// One Lambda behind a function URL, reached through CloudFront at /api/billing/*.
//   POST /api/billing/webhook   Paddle notification destination. Verifies the signature first.
//   POST /api/billing/signin    form field "email": emails a sign-in link if that email is a customer
//   GET  /api/billing/auth?t=   checks the sign-in link, sets the session cookie, goes to /account/
//   GET  /api/billing/me        JSON: signed in?, email, access, subscriptions (for the account page)
//   POST /api/billing/portal    signed-in only: mints a Paddle customer portal session, 303 to it
//   POST /api/billing/signout   clears the session cookie

import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { loadConfig } from './config.mjs';
import { DynamoStore } from './store.mjs';
import { routeEvent } from './events.mjs';
import { makeBackerFulfillment } from './fulfillment.mjs';
import { anySubscriptionGrantsAccess, subscriptionGrantsAccess } from './access.mjs';
import { signToken, verifyToken, sessionCookie, readCookie, LOGIN_TTL, SESSION_TTL, COOKIE } from './session.mjs';

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

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

function formField(event, name) {
  const raw = rawBody(event);
  const ctype = header(event, 'content-type') || '';
  if (ctype.includes('application/json')) {
    try { return JSON.parse(raw)[name]; } catch { return undefined; }
  }
  return new URLSearchParams(raw).get(name) ?? undefined;
}

export function makeApp(deps) {
  const { cfg, store, paddle, sendEmail } = deps;

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

  async function signin(event) {
    const email = String(formField(event, 'email') || '').trim();
    const done = redirect(`${cfg.site}/account/?sent=1`);
    if (!EMAIL_RE.test(email) || email.length > 254) return redirect(`${cfg.site}/account/?error=email`);
    const customer = await store.findCustomerByEmail(email);
    // Same answer whether or not the email is a customer, so the form does not reveal who is.
    if (!customer) return done;
    const token = signToken(cfg.sessionSecret, 'login', { e: customer.email_lc }, LOGIN_TTL);
    const link = `${cfg.site}/api/billing/auth?t=${encodeURIComponent(token)}`;
    await sendEmail({
      to: customer.email,
      subject: 'Sign in to your Turtlebox account',
      text: `Use this link to sign in and manage your subscription, payment method and invoices:\n\n${link}\n\nIt works for 15 minutes. If you did not ask for it, ignore this email.\n\nTurtlebox`,
    });
    return done;
  }

  async function auth(event) {
    const t = event.queryStringParameters?.t;
    const data = verifyToken(cfg.sessionSecret, 'login', t);
    if (!data) return redirect(`${cfg.site}/account/?error=link`);
    // Resolve the Paddle customer server-side from the verified email.
    const customer = await store.findCustomerByEmail(data.e);
    if (!customer) return redirect(`${cfg.site}/account/?error=link`);
    const session = signToken(cfg.sessionSecret, 'session', { c: customer.customer_id }, SESSION_TTL);
    return redirect(`${cfg.site}/account/`, [sessionCookie(session, SESSION_TTL)]);
  }

  async function currentCustomer(event) {
    const data = verifyToken(cfg.sessionSecret, 'session', readCookie(event, COOKIE));
    if (!data?.c) return null;
    return store.getCustomer(data.c);
  }

  async function me(event) {
    const customer = await currentCustomer(event);
    if (!customer) return json(200, { signedIn: false });
    const subs = await store.listSubscriptions(customer.customer_id);
    return json(200, {
      signedIn: true,
      email: customer.email,
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
      if (path === '/api/billing/webhook' && method === 'POST') return await webhook(event);
      if (path === '/api/billing/signin' && method === 'POST') return await signin(event);
      if (path === '/api/billing/auth' && method === 'GET') return await auth(event);
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
  const onPurchase = makeBackerFulfillment({ cfg, store, paddle, sendEmail, log });
  return makeApp({ cfg, store, paddle, sendEmail, onPurchase });
}

export async function handler(event) {
  if (!app) app = await buildApp();
  return app(event);
}
