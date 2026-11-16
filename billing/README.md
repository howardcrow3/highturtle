# Turtlebox billing

Server-side fulfillment for Paddle (live account, High Turtle LLC as seller). One Node 22 Lambda,
`turtlebox-billing`, behind CloudFront at `https://turtlebox.studio/api/billing/*`.

| Route | What it does |
|---|---|
| `POST /api/billing/webhook` | Paddle notification destination. Verifies `Paddle-Signature` with `paddle.webhooks.unmarshal(rawBody, secret, signature)` on the raw body before anything else. Bad or missing signature: 400/401. Handler error: 500, so Paddle retries. |
| `POST /api/billing/signin` | Emails a 15-minute sign-in link to a known customer email. Same answer for unknown emails. |
| `GET /api/billing/auth?t=` | Checks the link, resolves the Paddle customer ID server-side, sets an HttpOnly session cookie (7 days). |
| `GET /api/billing/me` | Session status, access and subscriptions, for `/account/`. |
| `POST /api/billing/portal` | Signed-in only. Mints a Paddle customer portal session for the session's customer and 303s to it. |
| `POST /api/billing/signout` | Clears the cookie. |

The account page is `turtlebox/account/index.html` (`https://turtlebox.studio/account/`).

## Events handled

`customer.created`, `customer.updated` → `highturtle-billing-customers`
`subscription.created`, `subscription.updated`, `subscription.canceled` → `highturtle-billing-subscriptions`
`transaction.completed` → `highturtle-billing-transactions`, then Backer fulfillment (`src/fulfillment.mjs`)
Everything else is acknowledged with 200 and ignored.

Writes are upserts keyed on the Paddle ID, guarded by the entity's `updated_at`, so redeliveries are
harmless and an older event that arrives late is skipped. Nothing here deletes rows.

## Backer license keys

When a completed transaction includes a price in `BACKER_PRICE_IDS`, the buyer gets an email with a signed
Backer license key (`src/license.mjs`, same format as the Backer app's key issuer). It runs at most once per
transaction: claim, send, mark done; a failure releases the claim and returns 500 so Paddle retries.
The signing key is `BACKER_SIGNING_KEY` in the Secrets Manager secret. Until it is set, each order is emailed
to `OPS_EMAIL` (info@turtlebox.studio) so a key can be issued by hand with `backer-keygen`.

## Access rule (`src/access.mjs`)

`active` and `trialing` grant access. `past_due` grants access while Paddle retries (set
`ACCESS_PAST_DUE=deny` to change that). `paused` and `canceled` do not. A `scheduled_change` (cancel or
pause at period end) never revokes access by itself.

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
