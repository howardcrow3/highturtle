# Turtlebox billing

Server-side fulfillment for Paddle (live account, High Turtle LLC as seller). One Node 22 Lambda,
`turtlebox-billing`, behind CloudFront at `https://turtlebox.studio/api/billing/*`.

| Route | What it does |
|---|---|
| `POST /api/billing/webhook` | Paddle notification destination. Verifies `Paddle-Signature` with `paddle.webhooks.unmarshal(rawBody, secret, signature)` on the raw body before anything else. Bad or missing signature: 400/401. Handler error: 500, so Paddle retries. |
| `GET /api/billing/google/start` | Sends the visitor to Google sign-in (state + nonce in a short-lived signed cookie). |
| `GET /api/billing/google/callback` | Exchanges the code with Google, checks issuer, audience, expiry, nonce and `email_verified`, then sets an HttpOnly session cookie (7 days) holding only that email. |
| `GET /api/billing/me` | Session status, access, subscriptions and purchases, for `/account/`. The Paddle customer is looked up from the session's verified email on every request. |
| `POST /api/billing/portal` | Signed-in only. Mints a Paddle customer portal session for the session's customer and 303s to it. |
| `POST /api/billing/signout` | Clears the cookie. |

The account page is `turtlebox/account/index.html` (`https://turtlebox.studio/account/`).

## Events handled

`customer.created`, `customer.updated` → `highturtle-billing-customers`
`subscription.created`, `subscription.updated`, `subscription.canceled` → `highturtle-billing-subscriptions`
`transaction.completed` → `highturtle-billing-transactions`, then Backer and CeeVee fulfillment (`src/fulfillment.mjs`, `src/ceevee-fulfillment.mjs`)
`adjustment.created`, `adjustment.updated` → a full, approved refund revokes the CeeVee key(s) bought in that transaction (`makeCeeveeRefund`). Add these two events to the Paddle notification destination.
Everything else is acknowledged with 200 and ignored.

Writes are upserts keyed on the Paddle ID, guarded by the entity's `updated_at`, so redeliveries are
harmless and an older event that arrives late is skipped. Nothing here deletes rows.

## Backer license keys

When a completed transaction includes a price in `BACKER_PRICE_IDS`, the buyer gets an email with a signed
Backer license key (`src/license.mjs`, same format as the Backer app's key issuer). It runs at most once per
transaction: claim, send, mark done; a failure releases the claim and returns 500 so Paddle retries.
The signing key is `BACKER_SIGNING_KEY` in the Secrets Manager secret. Until it is set, each order is emailed
to `OPS_EMAIL` (info@turtlebox.studio) so a key can be issued by hand with `backer-keygen`.

## CeeVee licensing

A completed transaction with a price in `CEEVEE_PRICE_IDS` creates one license per unit (`src/ceevee-fulfillment.mjs`) and emails
the key and a `ceevee://activate?key=` link. Keys are `CEEV-` plus 20 characters, derived by HMAC from the transaction ID and the
signing seed, so a Paddle retry re-sends the same key. Tables: `highturtle-ceevee-licenses` (key, email, seats, machines) and
`highturtle-ceevee-trials` (first start per machine). The app calls (`src/ceevee-api.mjs`, contract in the CeeVee repo's `docs/LICENSE_API.md`):

| Route | What it does |
|---|---|
| `POST /api/ceevee/v1/trial` | `{machine}` → signed trial token; the first start the server saw wins |
| `POST /api/ceevee/v1/activate` | `{key, machine, app_version, platform}` → signed license for that machine; 404 `unknown_key`; 409 `seats_full` after 2 computers |
| `POST /api/ceevee/v1/deactivate` | `{key, machine}` → 204, frees the seat |
| `POST /api/billing/ceevee/release` | Signed-in owner only, JSON `{key, id}` where `id` is the short computer id from `/me`; frees that seat (account page) |

Tokens are Ed25519 over the JSON bytes, signed with `CEEVEE_SIGNING_KEY` (64-hex seed in Secrets Manager); the app holds only the
public half (`CEEVEE_LICENSE_PUBKEY`). Until the key is set the endpoints answer 503 and orders are forwarded to `OPS_EMAIL`
(the event stays retryable; redeliver it from Paddle once the key is in).

### Backer activation (2 computers per key)

Keys stay offline-checkable, but the app also activates online (`src/backer-activation.mjs`, row logic shared with CeeVee's store). Routes, reached
through CloudFront at `/api/backer/*`:

| Route | What it does |
|---|---|
| `POST /api/backer/v1/activate` | `{key, machine, app_version, platform}` → `{token, refresh_after, expires_at}`. 404 `unknown_key` (signature fails), 403 `revoked`, 409 `seats_full` after 2 computers |
| `POST /api/backer/v1/deactivate` | `{key, machine}` → 204, frees the seat (the app's Deactivate button) |
| `POST /api/billing/release` | Signed-in owner only, `{key, id}`; frees one computer from `/account/`. Handles CeeVee and Backer keys |

- The key's signature is checked with `BACKER_PUBLIC_KEY` before anything is stored, so only genuine keys get a row. Existing keys need no migration:
  a row (table `highturtle-backer-activations`, id = SHA-256 of the key's bytes, never the key text) is created on first activation.
- The token is `base64url(json).base64url(sig)`, Ed25519 over `"backer-activation-v1\0" + json` with the same `BACKER_SIGNING_KEY` (the domain prefix
  keeps it distinct from license-key signatures). It is bound to the key id and the machine, good for 90 days, and the app refreshes after 7, so a
  license-service outage never stops a backup.
- Support reset: run the **Backer seat reset** workflow with the buyer's email (or the key); it empties the computers on that buyer's keys.
- To deactivate a key for good (refund, abuse), set `status` to `revoked` on its row; the app stops at its next refresh (within 7 days).
- Every unit gets its own key (and so its own 2 computers): the key's unused "issued day" carries a small per-unit offset (`unitDay` in `src/fulfillment.mjs`).

## Golden licensing

A completed transaction with `GOLDEN_PRICE_ID` (core, one-time) or `GOLDEN_PLAID_PRICE_ID` (bank-connection add-on, monthly) emails the
buyer a Golden licence key (`src/golden-fulfillment.mjs`, `src/golden.mjs`). The key is an Ed25519-signed token in the exact format of
`crates/fin-license` in howardcrow3/golden, verified offline by the app (a test pins the bytes to the Rust tool's output). At most once per
transaction (claim field `golden_fulfillment`). Each monthly add-on renewal is a new transaction, so it emails a fresh key with a later
paid-through date. Price IDs are repository variables `GOLDEN_PRICE_ID` and `GOLDEN_PLAID_PRICE_ID`, passed to the function by **Billing setup**.
`GOLDEN_SIGNING_KEY` (base64url seed) is created in Secrets Manager by **Billing setup** if missing; the run prints the public key
(`license_public_key.txt` in the Golden repo). Until the key exists, orders go to `OPS_EMAIL` and stay replayable from Paddle.

## Access rule (`src/access.mjs`)

`active` and `trialing` grant access. `past_due` grants access while Paddle retries (set
`ACCESS_PAST_DUE=deny` to change that). `paused` and `canceled` do not. A `scheduled_change` (cancel or
pause at period end) never revokes access by itself.

## Google sign-in setup

In Google Cloud console (any project): APIs & Services > OAuth consent screen: External, app name Turtlebox,
support email, authorized domain `turtlebox.studio`, scopes `openid` and `email`, then publish it. Credentials >
Create credentials > OAuth client ID > Web application, with authorized redirect URI
`https://turtlebox.studio/api/billing/google/callback`. Put the client ID and secret in the GitHub secrets
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and run **Billing setup**.

## Secrets

Never in the repo. On AWS they live in Secrets Manager `highturtle/billing` (JSON with `PADDLE_API_KEY`,
`PADDLE_WEBHOOK_SECRET`, `SESSION_SECRET`). Locally, copy `.env.example` to `.env`.
The webhook signing secret (`pdl_ntfset_...`) and the API key (`pdl_live_apikey_...`) are different values.

## Going live

1. Create a new Paddle live API key with customer read and customer portal session write permissions.
   Add it as the GitHub secret `PADDLE_API_KEY`.
2. Run the **Billing setup** workflow. It creates the tables, secret, function and the CloudFront route.
3. In Paddle: Developer tools > Notifications > New destination. URL
   `https://turtlebox.studio/api/billing/webhook`, type webhook, events `customer.created`,
   `customer.updated`, `subscription.created`, `subscription.updated`, `subscription.canceled`,
   `transaction.completed`. Copy its secret key into the GitHub secret `PADDLE_WEBHOOK_SECRET`.
4. Run **Billing setup** again so the signing secret reaches Secrets Manager.
5. The destination, its secret, products, prices and every customer, subscription and transaction are
   permanent infrastructure. Do not delete them.

## Develop

    cd billing && npm ci && npm test && npm run build
