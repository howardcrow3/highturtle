# highturtle.com

Static site. No build step: plain HTML, CSS and a little JavaScript. Hosted on AWS (S3 + CloudFront) and deployed from this repo by GitHub Actions.

## Files

- `index.html`: the home page
- `assets/styles.css`, `assets/site.js`: styles and behavior
- `skills-map.html`: the skills map (every product activity and the skill that covers it), generated from the skills-map data and kept as plain static HTML
- `thanks.html`: confirmation page (used if the form falls back to a normal post)
- `404.html`: not-found page
- `favicon.svg`, `robots.txt`, `sitemap.xml`
- `.github/workflows/deploy.yml`: syncs the site to S3 and clears the CloudFront cache on every push to `main`

## Before launch

1. **Signup is built in.** See the Email list section below.
2. **Check the copy.** The statuses in "What we make" (skills "drafted, in testing", playbooks and micro-tools "planned") and the activity counts come from the skills map. Update them as things ship.

## Design

- **Logo:** vector traces of the original artwork in `assets/` (`logo-horizontal.svg`, `logo-stacked.svg`, `mark.svg`, `wordmark.svg`). They use `currentColor`, so they follow the light and dark themes.
- **Palette:** Graphite, true neutral greys with one steel-blue accent, defined as variables at the top of `assets/styles.css`. A dark theme follows the visitor's system setting.
- **Type:** Literata for headlines and Figtree for text, both open-licensed and self-hosted in `assets/fonts/` (licenses included).
- **Social preview and icons:** `assets/og.png`, `favicon.svg` and `apple-touch-icon.png`, all made from the logo.

## AWS setup

Already done, by `infra/setup-aws.sh` (run once from the "AWS setup (one time)" workflow; safe to re-run):

- Private S3 bucket `highturtle.com` (us-east-2), readable only through CloudFront
- CloudFront distribution `E3GVOW0DH898BT` for `highturtle.com` and `www.highturtle.com`, with an ACM certificate and a 404 page
- Route 53 alias records for the apex and `www`. Email records (MX, SPF, DKIM, DMARC) are untouched.
- IAM role `highturtle-github-deploy`, assumed by this repo's `main` branch through GitHub OIDC (no stored keys)

The IDs the deploy workflow uses are set at the top of `.github/workflows/deploy.yml`.

Every push to `main` syncs the site to S3 and clears the CloudFront cache.

After setup, delete the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` repo secrets and deactivate that IAM access key. The deploy workflow doesn't use them.

## Preview locally

    python3 -m http.server 8000

Then open http://localhost:8000. Paths start with `/`, so serve from the repo root.


## Email list

Signup, confirmation and sending run on AWS in `us-east-2` and cost well under $1 a month at small scale.

- **Signup:** the form posts to `/api/subscribe`. CloudFront routes `/api/*` to the `highturtle-subscribe` Lambda (`lambda/handler.py`). A pending signup is stored in DynamoDB (`highturtle-pending`) for 48 hours and a confirmation email goes out through SES.
- **Confirm:** the link in that email calls `/api/confirm`, which adds the address to the SES contact list `highturtle-subscribers`.
- **Unsubscribe:** every issue carries a signed link and the one-click `List-Unsubscribe` headers. Bounces and complaints go to the SES suppression list automatically.
- **Setup:** `infra/setup-email.sh`, run by the `Email setup (one time)` workflow. Safe to re-run. It leaves the apex MX, SPF, DMARC and existing DKIM records alone and adds a `bounce.highturtle.com` MAIL FROM subdomain.
- **Lambda changes:** edit `lambda/handler.py` and push. The deploy workflow updates the function.
- **Sending:** write an issue as Markdown in `issues/` (see `issues/example-first-issue.md`), then run the `Send an issue` workflow. Use mode `test` first. Sending to the list needs mode `send` and `SEND` typed in the confirm box.
- **Before the first real send:** set `postal_address` in `infra/mail-config.json` (marketing email must carry one) and wait for SES production access (the `Request SES production access` workflow files the request).

## Turtlebox app downloads

Apps for download live in the private S3 bucket `turtlebox-downloads` as `<app-slug>/<file>`. The newest file under a slug is served.

1. Upload: `bash infra/upload-app.sh <slug> <file> "App title"` (or drag the file into that folder in the S3 console).
2. In `turtlebox/apps.json` set `"download": true` on the app, run `python3 turtlebox/build.py`, and push. The card then shows an email form.
3. Someone enters their address, gets an email from `downloads@turtlebox.studio` with a link (valid 7 days), and clicking it adds them to the High Turtle list and starts a 5-minute download. People who unsubscribed earlier are not re-added.

Code: `lambda/downloads.py`, set up by `infra/setup-downloads.sh`. Pushes to `lambda/downloads.py` or `turtlebox/` deploy through the `Deploy turtlebox.studio` workflow.
