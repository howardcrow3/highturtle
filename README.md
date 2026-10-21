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

1. **Connect the signup form.** In `index.html`, replace `YOUR_FORM_ID` in the form's `action` with a real endpoint from Formspree, Buttondown or similar. Until then the form shows a "not connected" message instead of failing silently. Set the service's redirect to `https://highturtle.com/thanks.html` for visitors without JavaScript.
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
