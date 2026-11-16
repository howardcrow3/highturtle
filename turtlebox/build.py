#!/usr/bin/env python3
"""Generates the Turtlebox store pages from apps.json. Run from the repo root: python3 turtlebox/build.py

turtlebox.studio is the store for three desktop apps: Backer, CeeVee and Golden. This script writes the home page (the store),
/apps/, the CeeVee and Golden pages (plus the /ceevee/buy, /ceevee/license and /ceevee/help pages the CeeVee app links to),
404 and the download confirmation pages. The Backer pages come from backer/build.py and the policy pages from legal/build.py.

apps.json fields: slug, name, status, kind, tagline, description, price, price_note, platforms, url, on_sale, buy_url.
An app with "on_sale": true shows a Buy button that goes to buy_url (its page's checkout). An app that is not on sale shows
its price, a "Not on sale yet" note and a form to hear when it goes on sale.
"""
import html, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "legal"))
sys.path.insert(0, HERE)
from site_legal import footer_block  # policy links and legal name (Paddle requirements)
from nav import nav_links
mark = open(os.path.join(HERE, "..", "assets", "mark.svg")).read()
mark_path = re.search(r'<path[^>]*/>', mark).group(0)
mark_vb = re.search(r'viewBox="([^"]+)"', mark).group(1)
V = "tb11"
e = html.escape


PADDLE_TOKEN = json.load(open(os.path.join(HERE, "..", "backer", "config.json")))["paddle_client_token"]
# Buy buttons: open Paddle's overlay checkout for the button's price ID. The token and price IDs are public by design.
# Without Paddle.js the button falls back to the app page.
PADDLE_BUY = """<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>
(function () {
  if (!window.Paddle) return;
  Paddle.Initialize({ token: '%s' });
  document.querySelectorAll('[data-paddle-price]').forEach(function (b) {
    b.addEventListener('click', function (ev) {
      ev.preventDefault();
      Paddle.Checkout.open({
        items: [{ priceId: b.getAttribute('data-paddle-price'), quantity: 1 }],
        settings: { displayMode: 'overlay', theme: 'light', successUrl: b.getAttribute('data-success') }
      });
    });
  });
})();
</script>""" % PADDLE_TOKEN


def page(title, desc, body, path, robots=True, nav_current=""):
    return f"""<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#F5F0E7">
  {'' if robots else '<meta name="robots" content="noindex">'}
  <title>{e(title)}</title>
  <meta name="description" content="{e(desc)}">
  <link rel="canonical" href="https://turtlebox.studio{path}">
  <meta property="og:title" content="{e(title)}">
  <meta property="og:description" content="{e(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://turtlebox.studio{path}">
  <meta property="og:image" content="https://turtlebox.studio/assets/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preload" href="/assets/fonts/Inter-Light.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/styles.css?v={V}">
  <link rel="stylesheet" href="/assets/store.css?v={V}">
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><symbol id="mark" viewBox="{mark_vb}">{mark_path}</symbol></svg>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="Turtlebox home">
      <svg class="brand-mark" viewBox="{mark_vb}" aria-hidden="true"><use href="#mark"/></svg>
      <span class="brand-name">Turtlebox</span>
    </a>
    <nav aria-label="Main">
      {nav_links(nav_current, V)}
    </nav>
  </div>
</header>
<main id="main">
{body}
</main>
<footer class="site-footer">
  <div class="wrap foot">
    <p>Turtlebox makes Backer, CeeVee and Golden. Also from us: <a href="https://highturtle.com">High Turtle</a>.</p>
      {footer_block("turtlebox")}
  </div>
</footer>
  <script src="/assets/site.js?v={V}" defer></script>
{PADDLE_BUY if 'data-paddle-price' in body else ''}
</body>
</html>
"""


def notify_form(a, hid):
    """Release news signup for an app that is not on sale. Posts to the High Turtle list (confirmation email, then a
    confirmation page on highturtle.com). Works without JavaScript."""
    return f"""<form class="notify-form" action="https://highturtle.com/api/subscribe" method="POST">
          <label for="n-{hid}">Email me when {e(a["name"])} is on sale</label>
          <div class="notify-row">
            <input id="n-{hid}" name="email" type="email" autocomplete="email" required placeholder="you@company.com">
            <button class="btn btn-small" type="submit">Email me</button>
          </div>
          <p class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="_gotcha" tabindex="-1" autocomplete="off"></label></p>
          <p class="fine">You join the High Turtle list for release news, including when {e(a["name"])} goes on sale. We confirm your address first, and you can unsubscribe any time. <a href="/privacy.html">Privacy</a></p>
        </form>"""


def buy_plate(a, hid, compact=False):
    """Price and the one action that matters: Buy when on sale, otherwise the date-free 'not on sale yet' and a signup."""
    price = f'<p class="price-big"><span class="num">{e(a["price"])}</span> <span class="price-note">{e(a["price_note"])}</span></p>'
    plats = f'<p class="plats">{e(a["platforms"])}</p>'
    if a.get("on_sale"):
        action = (f'<a class="btn btn-buy" href="{e(a["url"])}#buy" data-paddle-price="{e(a["price_id"])}" data-success="{e(a["success_url"])}">Buy {e(a["name"])}</a>'
                  f'<p class="fine">14-day free trial in the app. Sold by Paddle, our Merchant of Record.</p>')
    else:
        action = f'<p class="soon">Not on sale yet</p>' + (
            f'<a class="btn btn-small btn-quiet" href="{e(a["url"])}#buy">Get notified</a>' if compact else notify_form(a, hid))
    return f'<div class="buy-plate">{price}{plats}{action}</div>'


def status_chip(a):
    cls = "status status-live" if a.get("on_sale") else "status status-testing"
    return f'<p class="{cls}">{e(a["status"])}</p>'


def store_row(a, level="h2"):
    more = f'<a class="link" href="{e(a["url"])}">About {e(a["name"])}</a>'
    return f"""      <li class="app-row" id="{e(a["slug"])}">
        <div class="app-row-text">
          <{level} class="app-name"><a href="{e(a["url"])}">{e(a["name"])}</a></{level}>
          <p class="app-tagline">{e(a["tagline"])}</p>
          <p class="app-desc">{e(a["description"])}</p>
          <div class="app-row-meta">{status_chip(a)}<p class="app-kind">{e(a["kind"])}</p>{more}</div>
        </div>
        {buy_plate(a, a["slug"] + "-row", compact=True)}
      </li>"""


apps = json.load(open(os.path.join(HERE, "apps.json")))
by_slug = {a["slug"]: a for a in apps}
store = '<ul class="store">\n' + "\n".join(store_row(a) for a in apps) + "\n    </ul>"

HOW_TO_BUY = """  <section class="section" aria-labelledby="buying-h">
    <div class="wrap">
      <h2 id="buying-h">How buying works</h2>
      <ul class="points">
        <li><h3>Pay once</h3><p>Each app has one price. There is no subscription. A license key covers every update within its major version.</p></li>
        <li><h3>Key by email</h3><p>Your license key arrives by email a few minutes after checkout. It is also in <a href="/account/">your account</a> when you sign in with Google.</p></li>
        <li><h3>14 days to change your mind</h3><p>Paddle, our Merchant of Record, takes payment and adds any tax. Ask for a refund within 14 days. <a href="/refund.html">Refund policy</a></p></li>
      </ul>
    </div>
  </section>"""

home = f"""  <section class="hero store-hero">
    <div class="wrap">
      <h1>Desktop apps that keep your files on your computer.</h1>
      <p class="lede">Turtlebox makes three apps for Mac and Windows. Backer backs up your photos and videos, CeeVee runs your job search and Golden plans your retirement. Each one is a single purchase, and your files stay with you.</p>
    </div>
  </section>
  <section class="section store-section" aria-label="The apps">
    <div class="wrap">
    {store}
    </div>
  </section>
{HOW_TO_BUY}"""

apps_page = f"""  <div class="wrap page-head">
    <h1>Apps</h1>
    <p>Three desktop apps for Mac and Windows. Each one is a single purchase, and your files stay on your computer.</p>
  </div>
  <section class="section store-section" aria-label="The apps">
    <div class="wrap">
    {store}
    </div>
  </section>
{HOW_TO_BUY}"""


# ---------- App pages (CeeVee, Golden). Backer has its own generator in backer/build.py. ----------

APP_PAGES = {
    "ceevee": {
        "title": "CeeVee job search app",
        "h1": "Run your job search from your own computer.",
        "lede": "CeeVee keeps your resume, the jobs you are tracking and your applications in one place on your computer. Its AI model runs on your computer too, so there is no AI account or key to set up.",
        "features": [
            ("Your profile, once", "Drop in your resume or your LinkedIn profile PDF. CeeVee builds your profile from it and shows what it found before saving anything."),
            ("A tailored resume for each job", "Paste a job posting. CeeVee lists what the job asks for, shows where you match and where you don't, and drafts a resume and cover letter. It never invents experience."),
            ("Applications filled in for you", "CeeVee opens the application page in a separate browser window, fills in the fields from your profile and attaches your files. It stops before Submit so you can check."),
            ("Replies matched to applications", "Connect Gmail, Outlook, Yahoo, iCloud or any mailbox. CeeVee reads replies from employers, links each one to its application, updates the status and drafts an answer for you to edit."),
            ("Searches while you work", "CeeVee keeps running in the menu bar or system tray, searches for new jobs in the categories you pick, and tells you when something new turns up."),
            ("Everything in one folder", "Resumes and cover letters are saved as PDF and Word files in a normal folder. Export everything, or delete everything, any time."),
        ],
        "facts": [
            ("Price", "$19.99 once. One license works on 2 computers."),
            ("Trial", "14 days with every feature. After that, CeeVee turns read-only until you add a license: you can still view and export everything."),
            ("Computers", "Windows 11 (64-bit) or a Mac with Apple silicon running macOS 13 or newer."),
            ("AI model", "A one-time download of about 2.5 GB that runs on your computer. You need about 3 GB of free space."),
            ("What goes over the internet", "License and update checks, the one-time model download, and the mailbox and job sites you choose to connect."),
        ],
        "help": "/ceevee/help/",
    },
    "golden": {
        "title": "Golden household finance and retirement app",
        "h1": "See when your household can retire.",
        "lede": "Golden turns the statement files your bank and card companies already give you into household books and a retirement plan. It shows the month each of you can retire and what would move that date. Your statements and plan stay on your computer.",
        "features": [
            ("Statements in, books out", "Import the CSV or OFX files from your bank and card accounts. Golden files each statement, sorts the transactions into categories and remembers how you corrected them."),
            ("Cash flow at any scale", "See what came in and went out by week, month, quarter or year, for each person or the whole household."),
            ("A retirement plan you can test", "Golden projects your money forward with federal and state tax, and runs thousands of possible market outcomes to show how likely the plan is to last."),
            ("Ask “what if”", "Type a question such as “what if we both retire at 62” and see the effect on the plan before anything changes."),
            ("Two people, one plan", "Every account and income belongs to one of you or to both, with its own retirement age and Social Security age."),
            ("Locked on your computer", "The database is encrypted, and its key is kept in your computer's keychain. Golden never moves money or places trades."),
        ],
        "facts": [
            ("Price", "$39.99 once."),
            ("Trial", "14 days with every feature."),
            ("Computers", "A Mac with Apple silicon running macOS 13 or newer, or Windows 11 (64-bit)."),
            ("Where it works", "United States households. Six states' income tax (AR, CT, MD, MN, NY and VT) is approximate for now."),
            ("What goes over the internet", "Update checks only, by default. Bank connections are planned as an optional extra for $5 a month and are not available yet."),
        ],
        "help": "",
    },
}


def app_page(slug):
    a, p = by_slug[slug], APP_PAGES[slug]
    feats = "\n".join(f'        <li><h3>{e(t)}</h3><p>{e(d)}</p></li>' for t, d in p["features"])
    facts = "\n".join(f'        <div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in p["facts"])
    help_link = f' &middot; <a href="{p["help"]}">Help</a>' if p["help"] else ""
    return f"""  <section class="app-hero" id="buy">
    <div class="wrap app-hero-grid">
      <div>
        <h1>{e(p["h1"])}</h1>
        <p class="lede">{e(p["lede"])}</p>
        <div class="app-row-meta">{status_chip(a)}<p class="app-kind">{e(a["name"])}, a Turtlebox app &middot; {e(a["kind"])}</p></div>
      </div>
      {buy_plate(a, slug + "-hero")}
    </div>
  </section>
  <section class="section" aria-labelledby="what-h">
    <div class="wrap">
      <h2 id="what-h">What {e(a["name"])} does</h2>
      <ul class="points points-6">
{feats}
      </ul>
    </div>
  </section>
  <section class="section" aria-labelledby="facts-h">
    <div class="wrap">
      <h2 id="facts-h">Price and requirements</h2>
      <dl class="facts">
{facts}
      </dl>
      <p class="fine facts-fine">Orders are processed by Paddle.com, our online reseller and Merchant of Record. <a href="/refund.html">Refund policy</a> &middot; <a href="/terms.html">Terms</a> &middot; <a href="/privacy.html">Privacy</a>{help_link}</p>
    </div>
  </section>"""


def ceevee_simple(h1, body_html):
    return f"""  <div class="simple wrap">
    <h1>{h1}</h1>
{body_html}
  </div>"""


ceevee = by_slug["ceevee"]
ceevee_buy = ceevee_simple("Buy CeeVee", f"""    <p>{e(ceevee["price"])} once. One license works on 2 computers and covers every 1.x version. Your license key arrives by email a few minutes after checkout, with a link that activates it in CeeVee.</p>
    <a class="btn btn-buy" href="/ceevee/" data-paddle-price="{e(ceevee["price_id"])}" data-success="{e(ceevee["success_url"])}">Buy CeeVee</a>
    <p class="fine">Orders are processed by Paddle.com, our online reseller and Merchant of Record. <a href="/refund.html">Refund policy</a> &middot; <a href="/terms.html">Terms</a></p>
    <script>
    /* Opened from the app (?from=app): start the checkout straight away. */
    if (/[?&]from=app/.test(location.search)) window.addEventListener('load', function () {{ var b = document.querySelector('[data-paddle-price]'); if (b && window.Paddle) b.click(); }});
    </script>""")
ceevee_license = ceevee_simple("Your CeeVee license", """    <p>Sign in with Google using the email address you bought with. Your account page shows your license key and your orders.</p>
    <p>To move CeeVee to another computer, open Settings, then License, and choose &ldquo;Remove from this computer&rdquo;. Then activate on the new one with the same key. One license works on 2 computers.</p>
    <a class="btn" href="/account/">Go to your account</a>""")
ceevee_help = f"""  <div class="wrap page-head">
    <h1>CeeVee help</h1>
    <p>Installing CeeVee, getting started, your license and fixes for common problems.</p>
  </div>
  <section class="section" aria-label="Help">
    <div class="wrap prose-help">
      <h2>Install</h2>
      <p><strong>Windows 11:</strong> run <code>CeeVee-setup.exe</code>. It installs for your user account and needs no administrator password. If Windows SmartScreen warns you, choose More info, then Run anyway, but only if you downloaded the file from turtlebox.studio.</p>
      <p><strong>Mac (Apple silicon):</strong> open <code>CeeVee.dmg</code> and drag CeeVee to Applications.</p>
      <p>CeeVee updates itself. To check now, open Settings, then About CeeVee, and choose Check for updates.</p>
      <h2>First steps</h2>
      <ol>
        <li>Open CeeVee. Your 14-day trial starts automatically.</li>
        <li>In Settings, Local AI, download the AI model. It is about 2.5 GB, downloads once and runs on your computer.</li>
        <li>On the Welcome page, paste your resume. CeeVee shows what it found; tick what to keep.</li>
        <li>In Settings, add the kinds of jobs you want under Job categories and the companies you like under Companies to watch.</li>
        <li>CeeVee searches in the background and shows new jobs under Jobs. It keeps running in the system tray (Windows) or menu bar (Mac) when you close the window. Quit from there.</li>
      </ol>
      <h2>Buying and your license</h2>
      <ul>
        <li>CeeVee costs {e(ceevee["price"])} once, and one license works on 2 computers. Buy it from Settings, License, or on this site.</li>
        <li>Your key arrives by email. Click the activation link in the email, or paste the key into Settings, License.</li>
        <li>To move to a new computer, open Settings, License and choose Remove from this computer, then activate on the new one.</li>
        <li>After the trial without a license, CeeVee turns read-only. You can still look at and export everything.</li>
      </ul>
      <h2>Problems</h2>
      <ul>
        <li><strong>The model will not download.</strong> Check your connection and that you have about 3 GB free, then try again. Downloads resume where they stopped.</li>
        <li><strong>CeeVee closed unexpectedly.</strong> It says so on the next start. Open Settings, About CeeVee, Open log folder, and send the files to {e("info@turtlebox.studio")}.</li>
        <li><strong>No jobs appear.</strong> Add a job category and some companies in Settings, then wait for the next search.</li>
        <li><strong>The activation link does nothing.</strong> Paste the key into Settings, License instead.</li>
        <li><strong>CeeVee says the trial is over too early.</strong> CeeVee notices clock changes. Set your computer's clock to the right time.</li>
      </ul>
      <h2>Where your data is</h2>
      <p>Windows: <code>%APPDATA%\\studio.turtlebox.ceevee</code>. Mac: <code>~/Library/Application Support/studio.turtlebox.ceevee</code>. To back it up, copy that folder while CeeVee is closed.</p>
      <p>Still stuck? Write to <a href="mailto:info@turtlebox.studio">info@turtlebox.studio</a>.</p>
    </div>
  </section>"""

# Shared checkout page: Paddle's default payment link for every app (Paddle > Checkout > Checkout settings).
# Paddle sends buyers here with ?_ptxn=txn_...; Paddle.js opens the checkout for that transaction by itself.
checkout_body = """  <div class="simple wrap">
    <div id="co-wait">
      <h1>Opening checkout.</h1>
      <p>The secure Paddle checkout opens on this page. If nothing appears, check that your link is complete, or go back to the app you are buying and press Buy again.</p>
    </div>
    <div id="co-none" hidden>
      <h1>There is nothing to pay here.</h1>
      <p>This page opens checkouts started from a Turtlebox app or link. To buy an app, choose it from the store.</p>
      <a class="btn" href="/apps/">See the apps</a>
    </div>
    <div id="co-done" hidden>
      <h1>Thanks for your order.</h1>
      <p>Your license key is on its way by email from Turtlebox, usually within a few minutes. Paddle, our Merchant of Record, sends the receipt separately. Your keys and orders are also in <a href="/account/">your account</a> when you sign in with Google.</p>
      <a class="btn" href="/account/">Go to your account</a>
    </div>
    <p class="fine" style="margin-top:var(--space-xl)">Orders are processed by Paddle.com, our online reseller and Merchant of Record. <a href="/refund.html">Refund policy</a> &middot; <a href="/terms.html">Terms</a></p>
  </div>
<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>
(function () {
  var has = /[?&]_ptxn=txn_/.test(location.search);
  function show(id) { ['co-wait', 'co-none', 'co-done'].forEach(function (x) { document.getElementById(x).hidden = x !== id; }); }
  if (/[?&]done=/.test(location.search)) { show('co-done'); return; }
  if (!has) { show('co-none'); return; }
  if (!window.Paddle) return;
  Paddle.Initialize({
    token: '%s',
    checkout: { settings: { displayMode: 'overlay', theme: 'light' } },
    eventCallback: function (ev) { if (ev && ev.name === 'checkout.completed') show('co-done'); }
  });
})();
</script>""" % PADDLE_TOKEN

nf = """  <div class="simple wrap">
    <h1>That page isn't here.</h1>
    <p>The link may be old or mistyped. The apps page lists everything Turtlebox makes.</p>
    <a class="btn" href="/apps/">See the apps</a>
  </div>"""

sent = """  <div class="simple wrap">
    <h1>Check your inbox.</h1>
    <p>We sent your download link. It works for 7 days. If it does not arrive in a few minutes, check your spam folder.</p>
    <a class="btn" href="/apps/">Back to the apps</a>
  </div>"""
prob = """  <div class="simple wrap">
    <h1>That did not go through.</h1>
    <p>The link may have expired, or the address may not look right. Request the download again from the apps page.</p>
    <a class="btn" href="/apps/">Go to the apps</a>
  </div>"""
root = os.path.join(HERE)
def w(rel, content):
    p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(content)

desc_home = "Turtlebox makes Backer, CeeVee and Golden: desktop apps for Mac and Windows that keep your files on your computer. Each is a single purchase."
w("index.html", page("Turtlebox | Backer, CeeVee and Golden", desc_home, home, "/"))
w("apps/index.html", page("Apps | Turtlebox", "Backer, CeeVee and Golden: desktop apps for Mac and Windows from Turtlebox.", apps_page, "/apps/", nav_current="apps"))
w("ceevee/index.html", page("CeeVee job search app | Turtlebox", by_slug["ceevee"]["tagline"] + " " + by_slug["ceevee"]["description"], app_page("ceevee"), "/ceevee/", nav_current="ceevee"))
w("golden/index.html", page("Golden retirement planning app | Turtlebox", by_slug["golden"]["tagline"] + " " + by_slug["golden"]["description"], app_page("golden"), "/golden/", nav_current="golden"))
w("ceevee/buy/index.html", page("Buy CeeVee | Turtlebox", "Buy CeeVee: $19.99 once for 2 computers.", ceevee_buy, "/ceevee/buy/", robots=False, nav_current="ceevee"))
w("ceevee/license/index.html", page("Your CeeVee license | Turtlebox", "Find your CeeVee license key and move it to another computer.", ceevee_license, "/ceevee/license/", robots=False, nav_current="ceevee"))
w("ceevee/help/index.html", page("CeeVee help | Turtlebox", "Install CeeVee, get started, manage your license and fix common problems.", ceevee_help, "/ceevee/help/", nav_current="ceevee"))
w("checkout/index.html", page("Checkout | Turtlebox", "Paddle checkout for Turtlebox apps.", checkout_body, "/checkout/", robots=False))
w("download-sent.html", page("Check your inbox | Turtlebox", "Download link sent.", sent, "/download-sent.html", robots=False))
w("download-problem.html", page("Download problem | Turtlebox", "Download problem.", prob, "/download-problem.html", robots=False))
w("404.html", page("Page not found | Turtlebox", "Page not found.", nf, "/404.html", robots=False))
w("robots.txt", "User-agent: *\nAllow: /\n\nSitemap: https://turtlebox.studio/sitemap.xml\n")
urls = ["/", "/apps/", "/backer/", "/backer/releases.html", "/backer/notes.html", "/ceevee/", "/ceevee/help/", "/golden/",
        "/terms.html", "/refund.html", "/privacy.html", "/contact.html"]
w("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + "".join(f"  <url><loc>https://turtlebox.studio{u}</loc></url>\n" for u in urls) + "</urlset>\n")
fav = open(os.path.join(HERE, "design-system", "assets", "Icons", "favicon.svg")).read()
w("favicon.svg", fav)
print("built")
