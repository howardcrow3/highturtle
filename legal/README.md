# Paddle website requirements

Paddle reviews every domain you sell from before it approves checkout there. This folder holds the business details and policy pages both sites need to pass that review.

## What Paddle checks, and where each site meets it

| Requirement | highturtle.com | turtlebox.studio |
|---|---|---|
| Clear description of what is sold, not services | Home page, "What we make" | Home, Apps, Backer pages |
| Visible pricing | Nothing is for sale yet, so submit only turtlebox.studio to Paddle for now | Backer page, "Pricing" (`/backer/#pricing`) |
| What each purchase includes | Add when the first High Turtle product goes on sale | Backer pricing, "What you get" |
| Terms naming the legal business, with the Paddle Merchant of Record wording | `/terms.html` | `/terms.html` |
| Refund policy, 14 to 90 days, no "all sales final" | `/refund.html` | `/refund.html` |
| Privacy notice naming Paddle as a recipient, with legal name and address | `/privacy.html` | `/privacy.html` |
| Contact details | `/contact.html` | `/contact.html` |
| Policies reachable from navigation | Footer on every main page | Footer on every page |
| Live over HTTPS | CloudFront + ACM | CloudFront + ACM |
| Generative AI clauses (acceptable use, output accuracy, takedown) | Terms section 5 | Terms section 5 |

Sources: Paddle's domain review guide (paddle.com/help/start/account-verification/what-is-domain-approval) and its seller policy guide (developer.paddle.com, "draft seller policies").

## Filling in the details

1. Edit `legal/config.json` (legal name, address, governing law, refund window in days, 14 to 90).
2. Set `price` and, when you have it, `checkout_url` in `backer/config.json`.
3. Run `python3 legal/build.py` to rebuild the policy pages and every footer, then `python3 legal/build.py --check` until it says no placeholders are left.

The legal name must match the name on your Paddle account exactly. A mismatch is a common reason for rejection.

Do not add a Paddle API key to this repo. None of these pages need one.
