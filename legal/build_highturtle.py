#!/usr/bin/env python3
"""Generates the High Turtle pricing and legal pages (highturtle.com). Run from the repo root: python3 legal/build_highturtle.py
Writes pricing.html, terms.html, refunds.html, privacy.html and assets/paddle.js. Values come from backer/config.json."""
import json, os, re, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import content as legal

cfg = json.load(open(os.path.join(ROOT, "backer", "config.json")))
c = legal.ctx(cfg, "High Turtle", "highturtle.com", "hello@highturtle.com", ".html")
sym = re.search(r'<svg width="0".*?</svg>', open(os.path.join(ROOT, "privacy.html")).read(), re.S).group(0)
paddle_cfg = json.dumps({"clientToken": cfg.get("paddle_client_token", "").strip(), "priceId": cfg.get("paddle_price_id", "").strip(),
                         "environment": cfg.get("paddle_environment", "sandbox").strip() or "sandbox",
                         "successUrl": "https://turtlebox.studio/backer/thanks.html"})

def page(title, desc, body, fname, extra=""):
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
  <title>{title} | High Turtle</title>
  <meta name="description" content="{desc}">
  <link rel="canonical" href="https://highturtle.com/{fname}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/assets/fonts/Inter-Light.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/styles.css?v=tb2">
</head>
<body>
{sym}
  <header class="site-header">
    <div class="wrap bar">
      <a class="brand" href="/" aria-label="High Turtle home">
        <svg class="brand-mark" viewBox="0 0 426 225" aria-hidden="true"><use href="#mark"/></svg>
        <span class="brand-name">High Turtle</span>
      </a>
    </div>
  </header>
  <main class="simple wrap">
{body}
  </main>
  <footer class="site-footer">
    <div class="wrap foot">
      <p><a href="/pricing.html">Pricing</a> &middot; <a href="/terms.html">Terms</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/refunds.html">Refunds</a></p>
      <p>&copy; 2026 High Turtle</p>
    </div>
  </footer>
{extra}
</body>
</html>
"""

def w(rel, s): open(os.path.join(ROOT, rel), "w").write(s)
buy = '<a class="btn" href="https://turtlebox.studio/backer/" data-paddle-buy>Buy Backer</a>'
pricing = legal.pricing_body(c, buy).replace('<div class="wrap page-head">', '<div class="page-head wrap">', 1)
w("pricing.html", page("Pricing", "Backer is a one-time purchase with a free 14-day trial. One license key covers all 1.x versions.", pricing, "pricing.html",
   f'  <script>window.PADDLE_CONFIG={paddle_cfg};</script>\n  <script src="/assets/paddle.js?v=pd1" defer></script>'))
w("terms.html", page("Terms of service", "Terms of service for highturtle.com and the Backer app.", legal.terms_body(c), "terms.html"))
w("refunds.html", page("Refund policy", "Refund policy for Backer purchases.", legal.refunds_body(c), "refunds.html"))
w("privacy.html", page("Privacy", "How High Turtle handles email addresses and purchases.", legal.privacy_body(c), "privacy.html"))
shutil.copyfile(os.path.join(HERE, "paddle.js"), os.path.join(ROOT, "assets", "paddle.js"))

sm = open(os.path.join(ROOT, "sitemap.xml")).read()
for f in ("pricing", "terms", "refunds"):
    u = f"https://highturtle.com/{f}.html"
    if u not in sm:
        sm = sm.replace("</urlset>", f"  <url>\n    <loc>{u}</loc>\n    <lastmod>2026-11-15</lastmod>\n  </url>\n</urlset>")
open(os.path.join(ROOT, "sitemap.xml"), "w").write(sm)
print("High Turtle pricing and legal pages built; placeholders still to fill:", len(legal.PLACEHOLDERS))
