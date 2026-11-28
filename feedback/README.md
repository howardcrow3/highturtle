# High Turtle feedback service

One endpoint that Backer, CeeVee, Golden and our websites post user feedback to:

```
POST https://feedback.turtlebox.studio/v1/feedback
GET  https://feedback.turtlebox.studio/v1/health
```

Infrastructure as code in `template.yaml` (AWS SAM / CloudFormation, stack `highturtle-feedback`, us-east-2),
deployed by `.github/workflows/feedback-deploy.yml` on every push to `main` that touches `feedback/`, or by hand.

```
app / website ──HTTPS──> API Gateway HTTP API ──> Lambda highturtle-feedback ──> DynamoDB highturtle-feedback
                         (5 req/s, burst 20)      (Node 22, arm64)             └─> highturtle-feedback-limits (TTL)
```

## Request

```json
{
  "app": "backer",              // backer | ceevee | golden | highturtle-site | turtlebox-site  (required)
  "rating": 4,                  // whole number 1-5            (rating, message or both)
  "message": "Add a schedule",  // up to 5000 characters
  "category": "feature",        // feature | issue | praise | other   (optional)
  "email": "me@example.com",    // optional; checked for a valid address format (max 254 chars)
  "anonymous": false,           // optional; true = the email is dropped and never stored
  "appVersion": "1.2.0",        // optional
  "platform": "macos",          // optional
  "locale": "en-US"             // optional
}
```

Response `201 {"id": "<uuid>", "createdAt": "2026-11-26T12:00:00.000Z"}`.
Errors are `{"error": "..."}` with 400 (bad input), 401 (bad signature), 403 (origin or app not allowed),
409 (replayed request), 413 (body over 16 KB), 429 (over the per-IP limit of 20 an hour, or per-install 5 an hour / 20 a day).

## Stored record

| Field | |
|---|---|
| `id` | random UUID made by the server (partition key) |
| `createdAt` | server time, ISO 8601 UTC |
| `app` | which product the feedback is about |
| `rating`, `message`, `category`, `appVersion`, `platform`, `locale` | as sent |
| `email` | as sent, unless `anonymous` was true (then no email is stored at all) |
| `source` | `app` (signed) or `web` (website origin) |
| `status` | `new`; free for triage later |

Index `app-createdAt` lists one app's feedback newest first. IP addresses are not stored; the rate limiter
keeps a one-way hash of the IP for two hours only. The table has deletion protection and point-in-time recovery.

## Who can submit

**Desktop apps sign each request with a per-install key.** Each install makes its own Ed25519 key
(private half in the OS keychain) and sends:

```
x-ht-app: ceevee
x-ht-install: <64 hex, the install's public key = install id>
x-ht-timestamp: 1795694400
x-ht-signature: <128 hex Ed25519 signature over "<app>.<install>.<timestamp>.<raw body>">
```

The server checks the signature, a timestamp within 5 minutes, one use per signature, a 10 KB body cap, and
limits each install to 5 per hour and 20 per day (plus the per-IP limit). The install id is stored on the record
(`installId`). To block one install, add its id to `BLOCKED_INSTALLS` (comma-separated) in the Lambda environment.
The key is self-made, so this does not prove the app is genuine; the rate limits are what bound abuse.

**Shared app keys are retired.** Requests with `x-ht-app`/`x-ht-signature` but no `x-ht-install` get 401. The old SSM
parameter `/highturtle/feedback/app-keys` is deleted by the deploy workflow.

**Websites don't sign.** A browser can't keep a secret, so an unsigned request is accepted only when its
`Origin` is one of highturtle.com, highturtle.ai, turtlebox.studio (and `www.`). CORS is locked to the same list
plus the Tauri webview origins.

### The honest tradeoff

Nothing shipped to a user's computer can keep a secret. Someone determined can pull an app's key out of the
binary, and any HTTP client can fake an `Origin` header. So this keeps out casual and drive-by traffic (random
scanners, other sites' JavaScript, someone with curl), not a determined attacker. What limits the damage if a
key leaks or the origin check is spoofed:

- per-IP limit of 20 per hour and an API-wide cap of 5 requests/second (burst 20), so abuse can't run up the bill;
- strict validation and a 16 KB body limit, so junk can't be large;
- every install has its own key, so one abusive install is blocked alone (`BLOCKED_INSTALLS`) and nothing extracted
  from a build works for anyone else;
- a hidden honeypot field (`hp`) on web forms silently drops simple bots.

Stronger options cost money or friction, so they are not on by default: AWS WAF (about $6/month+),
a CAPTCHA such as Cloudflare Turnstile on the web form, or requiring a signed-in license key per submission.

## Client code

- `client/feedback.js`: `sendFeedback(feedback)` for websites (no key). Desktop apps (Backer, CeeVee, Golden) carry their own
  per-install signing code.


### In-app UI spec

1. A "Send feedback" item in the app's Help menu / settings opens a small dialog.
2. Five tappable stars (optional), a category choice (Idea / Problem / Praise / Other), a text box
   (max 5000 chars, show a counter near the limit), an optional Email field and a "Send anonymously"
   checkbox (unchecked by default). Prefill Email from the signed-in account or license when there is one.
   When "Send anonymously" is checked, disable the Email field and send `anonymous: true` with no `email`.
   Check the address format before sending; the server checks it again.
3. Send is enabled once there is a rating or some text. Fill in `appVersion` and `platform` automatically.
4. On success show "Thanks, we read every one" and close. On 429 say "You've sent a lot of feedback
   recently, try again later". On a network error keep the text and offer Retry.
5. Never send anything without the user pressing Send.

Website forms add a visually hidden `<input name="hp" tabindex="-1" autocomplete="off">` and send its value as `hp`.

## Reading feedback

AWS console > DynamoDB > Tables > `highturtle-feedback` > Explore items (query index `app-createdAt` for one app).
Or from a terminal with AWS credentials:

```
aws dynamodb query --region us-east-2 --table-name highturtle-feedback --index-name app-createdAt \
  --key-condition-expression 'app = :a' --expression-attribute-values '{":a":{"S":"backer"}}' --no-scan-index-forward
```

## Cost

Everything is pay-per-use with nothing idle: HTTP API $1 per million requests, Lambda (arm64, 256 MB, ~50 ms)
and DynamoDB on-demand writes are fractions of a cent per thousand submissions, plus pennies for storage,
backups and 30-day logs. At 10,000 submissions a month the total is well under $1. The certificate and
SSM standard parameter are free.

## Tests

`npm test` (Node 22, no dependencies).
