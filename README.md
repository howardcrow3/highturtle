# highturtle.com

Static site. No build step: plain HTML, CSS and a little JavaScript. Hosted on AWS (S3 + CloudFront) and deployed from this repo by GitHub Actions.

## Files

- `index.html`: the home page
- `assets/styles.css`, `assets/site.js`: styles and behavior
- `thanks.html`: confirmation page (used if the form falls back to a normal post)
- `404.html`: not-found page
- `favicon.svg`, `robots.txt`, `sitemap.xml`
- `.github/workflows/deploy.yml`: syncs the site to S3 and clears the CloudFront cache on every push to `main`

## Before launch

1. **Connect the signup form.** In `index.html`, replace `YOUR_FORM_ID` in the form's `action` with a real endpoint from Formspree, Buttondown or similar. Until then the form shows a "not connected" message instead of failing silently. Set the service's redirect to `https://highturtle.com/thanks.html` for visitors without JavaScript.
2. **Add a social image** (1200 x 630) and an `og:image` meta tag in `index.html` if you want link previews.
3. **Check the copy.** The statuses in "What we make" (skills "drafted, in testing", playbooks and micro-tools "planned") and the activity counts come from the PM skills map. Update them as things ship.

## AWS setup (one time)

1. **S3 bucket.** Create a private bucket (block all public access) in your chosen region.
2. **CloudFront distribution.**
   - Origin: the bucket, using Origin Access Control (OAC). Apply the bucket policy CloudFront suggests.
   - Default root object: `index.html`.
   - Custom error response: 403 and 404 return `/404.html` with status 404 (S3 returns 403 for missing files when the bucket is private).
   - Alternate domain names: `highturtle.com` and `www.highturtle.com`. Request a public certificate for both in AWS Certificate Manager in **us-east-1**, validate it by DNS, and attach it.
   - Viewer protocol policy: redirect HTTP to HTTPS.
3. **DNS.** Point `highturtle.com` (alias) and `www` at the CloudFront distribution in Route 53, or at your DNS provider. Redirect `www` to the apex if you prefer one address.
4. **GitHub deploy role.** Create an IAM OIDC identity provider for `token.actions.githubusercontent.com`, and an IAM role GitHub can assume for `repo:howardcrow3/highturtle:ref:refs/heads/main`. Give it only `s3:ListBucket`, `s3:PutObject`, `s3:DeleteObject` on this bucket, and `cloudfront:CreateInvalidation` on this distribution.
5. **Repository variables** (GitHub: Settings, Secrets and variables, Actions, Variables):
   - `AWS_ROLE_ARN`: the role from step 4
   - `AWS_REGION`: the bucket's region
   - `S3_BUCKET`: the bucket name
   - `CLOUDFRONT_DISTRIBUTION_ID`: the distribution ID

After that, every push to `main` goes live within a minute or two. You can also run the workflow by hand from the Actions tab.

## Preview locally

    python3 -m http.server 8000

Then open http://localhost:8000. Paths start with `/`, so serve from the repo root.
