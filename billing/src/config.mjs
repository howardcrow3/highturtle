// Runtime configuration. Secrets never live in the repo.
//
// Locally (and in tests) everything comes from environment variables; see .env.example.
// On Lambda, BILLING_SECRET_ID names an AWS Secrets Manager secret holding a JSON object with
// PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, SESSION_SECRET and (optionally) BACKER_SIGNING_KEY. Values in that secret win over env vars.

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const SECRET_KEYS = ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET', 'SESSION_SECRET', 'BACKER_SIGNING_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];

let cached = null;

export async function loadConfig(env = process.env, { fetchSecret = defaultFetchSecret } = {}) {
  if (cached) return cached;
  const merged = { ...env };
  if (env.BILLING_SECRET_ID) {
    const fromSecret = await fetchSecret(env.BILLING_SECRET_ID, env.AWS_REGION);
    for (const k of SECRET_KEYS) if (fromSecret[k]) merged[k] = fromSecret[k];
  }
  const cfg = {
    paddleApiKey: merged.PADDLE_API_KEY || '',
    paddleWebhookSecret: merged.PADDLE_WEBHOOK_SECRET || '',
    paddleEnvironment: merged.PADDLE_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
    sessionSecret: merged.SESSION_SECRET || '',
    site: (merged.SITE || 'https://turtlebox.studio').replace(/\/$/, ''),
    fromAddr: merged.FROM_ADDR || 'Turtlebox <account@turtlebox.studio>',
    replyTo: merged.REPLY_TO || '',
    configSet: merged.CONFIG_SET || '',
    region: merged.AWS_REGION || 'us-east-2',
    tables: {
      customers: merged.CUSTOMERS_TABLE || 'highturtle-billing-customers',
      subscriptions: merged.SUBSCRIPTIONS_TABLE || 'highturtle-billing-subscriptions',
      transactions: merged.TRANSACTIONS_TABLE || 'highturtle-billing-transactions',
    },
    // What a past_due subscription means for access: "grant" (default, Paddle is still retrying
    // the payment) or "deny".
    pastDuePolicy: merged.ACCESS_PAST_DUE === 'deny' ? 'deny' : 'grant',
    // Backer one-time purchases: which Paddle price IDs mean "send a Backer license key".
    backerPriceIds: (merged.BACKER_PRICE_IDS || '').split(',').map((x) => x.trim()).filter(Boolean),
    // Hex Ed25519 seed that signs Backer keys. When missing, orders are forwarded to opsEmail to issue by hand.
    backerSigningKey: merged.BACKER_SIGNING_KEY || '',
    opsEmail: merged.OPS_EMAIL || 'info@turtlebox.studio',
    googleClientId: merged.GOOGLE_CLIENT_ID || '',
    googleClientSecret: merged.GOOGLE_CLIENT_SECRET || '',
  };
  cached = cfg;
  return cfg;
}

export function resetConfigCache() {
  cached = null;
}

async function defaultFetchSecret(id, region) {
  const sm = new SecretsManagerClient({ region });
  const out = await sm.send(new GetSecretValueCommand({ SecretId: id }));
  return JSON.parse(out.SecretString || '{}');
}
