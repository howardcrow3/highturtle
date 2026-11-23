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
from gtag import add_tag  # Google tag on every page
from showcase import gallery, feature_groups
mark = open(os.path.join(HERE, "..", "assets", "mark.svg")).read()
mark_path = re.search(r'<path[^>]*/>', mark).group(0)
mark_vb = re.search(r'viewBox="([^"]+)"', mark).group(1)
V = "tb15"
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
    return f'<div class="buy-plate">{price}{plats}{action}{plans_block(a, compact)}</div>'


def plans_block(a, compact=False):
    """Optional subscription plans under the one-time price (Golden: automatic bank updates, coming soon). A plan without a
    price_id yet is left out, so nothing shows until Paddle has the price."""
    plans = [p for p in a.get("plans", []) if p.get("price_id")]
    if not plans or not a.get("on_sale"):
        return ""
    if compact:
        prices = " or ".join(f'<span class="num">{e(p["price"])}</span> {e(p["per"])}' for p in plans)
        return f'<p class="plans-line">{e(a["plans_title"])}: {prices}. <a href="{e(a["url"])}#buy">See plans</a></p>'
    btns = "".join(
        f'<a class="btn btn-quiet btn-plan" href="{e(a["url"])}#buy" data-paddle-price="{e(p["price_id"])}" data-success="{e(p["success_url"])}">'
        f'<span class="num">{e(p["price"])}</span> {e(p["per"])}</a>' for p in plans)
    return (f'<div class="plans"><p class="plans-title">{e(a["plans_title"])}</p>'
            f'<p class="plans-note">{e(a["plans_note"])}</p><div class="plans-row">{btns}</div>'
            f'<p class="fine">Renews until you cancel.</p></div>')


def status_chip(a):
    cls = "status status-live" if a.get("on_sale") else "status status-testing"
    return f'<p class="{cls}">{e(a["status"])}</p>'


def store_row(a, level="h2"):
    more = f'<a class="link" href="{e(a["url"])}">About {e(a["name"])}</a>'
    return f"""      <li class="app-row" id="{e(a["slug"])}">
        <div class="app-row-text">
          <img class="app-icon" src="/assets/icons/{e(a["slug"])}.svg" width="56" height="56" alt="">
          <{level} class="app-name"><a href="{e(a["url"])}">{e(a["name"])}</a></{level}>
          <p class="app-tagline">{e(a["tagline"])}</p>
          <p class="app-desc">{e(a["description"])}</p>
          <div class="app-row-meta">{status_chip(a)}<p class="app-kind">{e(a["kind"])}</p>{more}</div>
        </div>
        {buy_plate(a, a["slug"] + "-row", compact=True)}
      </li>"""


apps = json.load(open(os.path.join(HERE, "apps.json")))
for _a in apps:  # a plan's Paddle price can come from a GitHub Actions variable named in price_id_var (set in the deploy)
    for _p in _a.get("plans", []):
        if not _p.get("price_id") and _p.get("price_id_var"):
            _p["price_id"] = os.environ.get(_p["price_id_var"], "").strip()
by_slug = {a["slug"]: a for a in apps}
store = '<ul class="store">\n' + "\n".join(store_row(a) for a in apps) + "\n    </ul>"

HOW_TO_BUY = """  <section class="section" aria-labelledby="buying-h">
    <div class="wrap">
      <h2 id="buying-h">How buying works</h2>
      <ul class="points">
        <li><h3>Pay once</h3><p>Each app has a one-time price, and a license key covers every update within its major version. Golden also offers an optional monthly or yearly plan. Automatic bank updates for those plans are coming soon.</p></li>
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
            ("Getting ready", [
                ("Your profile, once", "Drop in your resume, your LinkedIn profile PDF or your LinkedIn data export. CeeVee builds your profile from it and shows what it found before saving anything."),
                ("Jobs that fit", "CeeVee searches for new jobs in the categories you pick while it runs in the menu bar or system tray, scores each one against your profile and tells you when something new turns up."),
                ("People you know", "Import your LinkedIn connections and CeeVee shows who you know at each company on your list."),
            ]),
            ("Applying", [
                ("A tailored resume for each job", "CeeVee lists what the job asks for, shows where you match and where you don't, and drafts a resume and cover letter. It never invents experience."),
                ("Edit in plain words", "Change a document yourself, or ask for a change such as “make the opening shorter”. Every version is kept, with undo and redo."),
                ("PDF and Word files", "Resumes and cover letters are saved as PDF and Word files in a normal folder on your computer."),
                ("Applications filled in for you", "CeeVee opens the application page in its own browser window, fills in the fields from your profile and attaches your files. It stops before Submit."),
            ]),
            ("Following up", [
                ("Nothing sent without you", "Anything that would go out in your name waits on one list for you to approve or skip."),
                ("Replies matched to applications", "Connect Gmail, Outlook, Yahoo, iCloud or any mailbox. CeeVee links each reply from an employer to its application and updates the status."),
                ("Answers drafted for you", "For each reply, CeeVee drafts an answer for you to edit and send."),
                ("Yours to keep", "Export everything, or delete everything, any time. The AI model runs on your computer, so there is no AI account or key."),
            ]),
        ],
        "facts": [
            ("Price", "$19.99 once. One license works on 2 computers."),
            ("Trial", "14 days with every feature. After that, CeeVee turns read-only until you add a license: you can still view and export everything."),
            ("Computers", "Windows 11 (64-bit) or a Mac with Apple silicon running macOS 13 or newer."),
            ("AI model", "A one-time download of about 2.5 GB that runs on your computer. You need about 3 GB of free space."),
            ("What goes over the internet", "License and update checks, the one-time model download, and the mailbox and job sites you choose to connect."),
        ],
        "help": "/ceevee/help/",
        # No CeeVee release is published yet. Its release workflow puts stable copies at these addresses; set
        # "ready" to True after the first stable release.
        "trial": {"ready": False, "macos": "macOS 13 or newer, Apple silicon", "windows": "Windows 11, 64-bit",
                  "mac_url": "https://dl.turtlebox.studio/ceevee/latest/CeeVee.dmg", "win_url": "https://dl.turtlebox.studio/ceevee/latest/CeeVee-setup.exe",
                  "mac_file": "CeeVee.dmg", "win_file": "CeeVee-setup.exe", "github": "", "note": ""},
    },
    "golden": {
        "title": "Golden household finance and retirement app",
        "h1": "See when your household can retire.",
        "lede": "Golden turns the statement files your bank and card companies already give you into household books and a retirement plan. It shows the month each of you can retire and what would move that date. Your statements and plan stay on your computer.",
        "features": [
            ("Your books", [
                ("Statements in, books out", "Import CSV, OFX or text PDF statements one at a time, a whole folder at once, or from a folder Golden watches. Each import is checked against the closing balance the statement prints."),
                ("Categories that learn", "Fix a category once and Golden remembers that merchant. The built-in model suggests categories for lines it hasn't seen, and transfers between your own accounts never count as spending."),
                ("Ask in plain words", "Ask “what did we spend on groceries last quarter?” and get an answer taken only from your own books."),
                ("Month close", "Check a finished month, read a short summary, and lock it so nothing changes by accident. Reopen it if you need to."),
                ("Paystubs and withholding", "Paste a paystub to add pay to the plan, and check whether enough tax is being taken out of each paycheck."),
            ]),
            ("Spending and saving", [
                ("Where the money goes", "Budgets, cash flow by week, month, quarter or year, and a flow chart of money in and out with a slider for each year."),
                ("What repeats", "Golden finds your subscriptions, bills and paychecks, adds up what they cost in a year, and shows when the next one is due."),
                ("What stands out", "Plain-language notes on last month: what went up, what went down, and anything unusual."),
                ("Debts and goals", "Compare paying debts off by highest rate or smallest balance, see what extra money saves, and track savings goals against their dates."),
                ("Net worth over time", "Everything you own and owe, a month-end history, and a 12-month forecast of where you're headed."),
            ]),
            ("Your retirement", [
                ("When you could retire", "The earliest age that meets the success target you choose, for each of you, with milestones such as your FI number, Coast FI, Social Security, Medicare and required withdrawals."),
                ("The chance it lasts", "Thousands of market paths drawn from historical returns, with a fan chart of good and rough outcomes. Backtest the plan against real past markets."),
                ("Safe spending", "The most you can spend each year at the comfort level you pick, with spending rules and the order to draw from your accounts."),
                ("Progress against the plan", "See how your real net worth is tracking against what the plan expected, with check-ins along the way."),
                ("A score for your plan", "A checklist of what's missing and warnings where the plan may be less accurate than it looks."),
            ]),
            ("Taxes", [
                ("Federal and state income tax", "Including the alternative minimum tax, the SALT cap, investment income tax, the senior deductions, and Social Security taxed by the IRS rules."),
                ("Roth conversions", "Compare fixed or bracket-filling conversions side by side, including ones sized to stay under the first Medicare surcharge."),
                ("Medicare and required withdrawals", "Medicare premiums with the two-year income lookback, required minimum distributions, and giving straight from an IRA."),
                ("Gains and subsidies", "How much gain you can take at 0% tax, and where the health insurance subsidy cliff sits."),
                ("Self-employed", "Self-employment tax, the QBI deduction, and how much you can put in a Solo 401(k) or SEP IRA."),
            ]),
            ("Big decisions", [
                ("Ask “what if”", "Type “what if we both retire at 62” and see the plan with and without the change. Save scenarios and compare up to three."),
                ("When to claim Social Security", "Outcomes for each claiming age, and the age where waiting pays off."),
                ("Home and family", "Rent or buy, paying off the mortgage, downsizing, and children's childcare, college and tax credit."),
                ("Health care", "Estimates for health care and long-term care costs that you can adjust."),
                ("Investments and estate", "A check-up of your mix, fees and concentration, plus estate tax, the inherited IRA ten-year rule, early-withdrawal plans and donor-advised fund bunching."),
            ]),
            ("Your data", [
                ("Encrypted on your computer", "The database and a document vault for tax forms and statements are encrypted, with the key in your computer's keychain."),
                ("Private by default", "A Privacy page lists every outside service and what it would send. Nothing leaves your computer unless you turn it on."),
                ("Hide amounts", "One click hides dollar amounts when you share your screen."),
                ("Reports and plan files", "Save a printable plan report with CSV and JSON data, or share your plan as a file."),
                ("AI that stays home", "The built-in AI model runs on your computer. AI assistants you connect get read-only access, so they can look at your plan but never change it."),
                ("Two people, one plan", "Every account and income belongs to one of you or to both, including pensions, employer match and HSA."),
            ]),
        ],
        "facts": [
            ("Price", "$39.99 once. Or $9.97 a month or $100 a year, with automatic bank updates through Plaid coming soon."),
            ("Trial", "14 days with every feature."),
            ("Computers", "A Mac with Apple silicon running macOS 13 or newer, or Windows 11 (64-bit)."),
            ("Where it works", "United States households. Five states' income tax (AR, MD, MN, NY and VT) is approximate for now."),
            ("What goes over the internet", "Update and license checks only. Automatic bank updates through Plaid are coming soon. When they arrive they will be optional, part of the monthly or yearly plan."),
        ],
        "help": "",
        # Golden's installers are the rolling "nightly" release on GitHub. Their names carry the build number, so
        # the page looks up the current files when it loads, and falls back to the release page.
        "trial": {"ready": True, "macos": "macOS 13 or newer, Apple silicon", "windows": "Windows 10 or 11, 64-bit",
                  "mac_url": "https://github.com/howardcrow3/golden/releases/tag/nightly", "win_url": "https://github.com/howardcrow3/golden/releases/tag/nightly",
                  "mac_file": "Golden for Mac (.dmg)", "win_file": "Golden for Windows (setup .exe)",
                  "github": "howardcrow3/golden@nightly",
                  "note": "This is the latest build of Golden, updated as we work on it."},
    },
}


TRIAL_JS = """<script>
(function () {
  var ua = navigator.userAgent || '';
  document.documentElement.setAttribute('data-os', /Windows/.test(ua) ? 'win' : (/Mac/.test(ua) ? 'mac' : ''));
  document.querySelectorAll('[data-gh-release]').forEach(function (box) {
    var r = box.getAttribute('data-gh-release').split('@');
    fetch('https://api.github.com/repos/' + r[0] + '/releases/tags/' + r[1], { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (rel) {
        if (!rel || !rel.assets) return;
        [['mac', /_aarch64\\.dmg$/], ['win', /-setup\\.exe$/]].forEach(function (k) {
          var a = rel.assets.filter(function (x) { return k[1].test(x.name); })[0];
          var link = box.querySelector('[data-dl=' + k[0] + ']'), file = box.querySelector('[data-file=' + k[0] + ']');
          if (a && link) { link.href = a.browser_download_url; if (file) file.textContent = a.name + ' \\u00b7 ' + Math.round(a.size / 1048576) + ' MB'; }
        });
      }).catch(function () {});
  });
})();
</script>"""


def trial_section(a, t):
    """Free 14-day trial downloads for Mac and Windows. The card for this computer is listed first."""
    if not t or not t.get("ready"):
        return ""
    name = e(a["name"])
    gh = f' data-gh-release="{e(t["github"])}"' if t.get("github") else ""
    note = f'<p class="fine trial-note">{e(t["note"])}</p>' if t.get("note") else ""
    return f"""  <section class="section trial" id="try" aria-labelledby="try-h">
    <div class="wrap"{gh}>
      <h2 id="try-h">Try {name} free for 14 days</h2>
      <p class="trial-lede">Every feature, no account and no card. When the trial ends, buy a license to keep going.</p>
      <div class="trial-dls">
        <div class="trial-dl trial-dl-mac">
          <h3>Mac <span class="rec">For this computer</span></h3>
          <p class="req">{e(t["macos"])}</p>
          <a class="btn" data-dl="mac" href="{e(t["mac_url"])}">Download for Mac</a>
          <p class="file" data-file="mac">{e(t["mac_file"])}</p>
          <p class="fine">If your Mac says it can't check the app, right-click it and choose Open.</p>
        </div>
        <div class="trial-dl trial-dl-win">
          <h3>Windows <span class="rec">For this computer</span></h3>
          <p class="req">{e(t["windows"])}</p>
          <a class="btn" data-dl="win" href="{e(t["win_url"])}">Download for Windows</a>
          <p class="file" data-file="win">{e(t["win_file"])}</p>
          <p class="fine">The installer isn't code-signed yet, so Windows may warn you. Choose More info, then Run anyway.</p>
        </div>
      </div>
      {note}
    </div>
  </section>
{TRIAL_JS}
"""


def app_page(slug):
    a, p = by_slug[slug], APP_PAGES[slug]
    facts = "\n".join(f'        <div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in p["facts"])
    help_link = f' &middot; <a href="{p["help"]}">Help</a>' if p["help"] else ""
    return f"""  <section class="app-hero" id="buy">
    <div class="wrap app-hero-grid">
      <div>
        <img class="app-icon app-icon-lg" src="/assets/icons/{e(slug)}.svg" width="88" height="88" alt="">
        <h1 class="app-title">{e(a["name"])}</h1>
        <p class="app-headline">{e(p["h1"])}</p>
        <p class="lede">{e(p["lede"])}</p>
        <div class="app-row-meta">{status_chip(a)}<p class="app-kind">{e(a["kind"])} &middot; a Turtlebox app</p></div>
      </div>
      {buy_plate(a, slug + "-hero")}
    </div>
  </section>
{trial_section(a, p.get("trial"))}{gallery(slug, a["name"])}
  <section class="section" aria-labelledby="what-h">
    <div class="wrap">
      <h2 id="what-h">What {e(a["name"])} does</h2>
      {feature_groups(p["features"])}
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
    if rel.endswith(".html"):
        content = add_tag(content)
    p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(content)


ceevee_privacy = """  <div class="wrap page-head">
    <h1>CeeVee privacy notice</h1>
    <p>Last updated 21 November 2026. CeeVee is sold by High Turtle LLC under the Turtlebox name.</p>
  </div>
  <section class="section" aria-label="Privacy">
    <div class="wrap prose-help">
      <p>CeeVee runs on your computer. Your resume, profile, jobs, documents, mail and chats are stored on your computer and are not sent to us.</p>
      <h2>What stays on your computer</h2>
      <ul>
        <li>Your resume, profile, job list, applications, documents and notes, in CeeVee&rsquo;s data folder.</li>
        <li>The AI model and everything you ask it. It runs locally; nothing you write to it leaves your computer.</li>
        <li>Your LinkedIn connections file, if you import one.</li>
        <li>A small log file and crash reports, to help fix problems. They hold no resume, job or email text. They leave your computer only if you send them to support yourself.</li>
      </ul>
      <h2>What CeeVee sends over the internet</h2>
      <ul>
        <li><strong>License and trial checks</strong> go to turtlebox.studio: a random machine identifier (a one-way hash, not your name or computer name), the app version, and your license key when you activate or remove it.</li>
        <li><strong>Update checks</strong> go to dl.turtlebox.studio: a request for the update file list. No account or personal data.</li>
        <li><strong>Downloading the AI model</strong> goes to Hugging Face, a model host. A normal file download; they see your IP address, as any website would.</li>
        <li><strong>Searching for jobs</strong> goes to the job boards and company career pages you choose, with the same requests your browser would make to read public job lists.</li>
        <li><strong>Applying for a job</strong> goes to the employer&rsquo;s application site, through Chrome or Edge on your computer. It sends what you submit, the same as if you typed it yourself.</li>
        <li><strong>Buying</strong> is handled by Paddle.com, our online reseller and Merchant of Record. Your payment details go to Paddle, not to CeeVee.</li>
      </ul>
      <p>CeeVee has no analytics or advertising trackers.</p>
      <h2>Optional: Sign in with Google</h2>
      <p>If you choose to sign in with Google, CeeVee asks for read-only access to your Gmail (the gmail.readonly permission), plus your email address and basic profile. CeeVee uses it for one purpose: to notice replies from employers and recruiters so it can keep your job applications up to date.</p>
      <ul>
        <li>Mail is read by CeeVee on your computer and stored only on your computer. It is not sent to turtlebox.studio, High Turtle LLC or any other server, and no person at High Turtle LLC can see it.</li>
        <li>CeeVee does not use your mail for advertising, does not sell it, and does not use it to train AI models.</li>
        <li>CeeVee&rsquo;s own local AI model reads your mail on your computer to sort replies. Nothing is shared with another AI service.</li>
        <li>You can sign out at any time in Settings, and revoke access at myaccount.google.com/permissions. Deleting CeeVee&rsquo;s data folder removes the stored mail.</li>
      </ul>
      <p>CeeVee&rsquo;s use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
      <h2>Your choices</h2>
      <ul>
        <li>Delete all your CeeVee data: quit CeeVee and delete its data folder. Windows: <code>%APPDATA%\\studio.turtlebox.ceevee</code>. Mac: <code>~/Library/Application Support/studio.turtlebox.ceevee</code>.</li>
        <li>Free a license seat: Settings, License, &ldquo;Remove from this computer&rdquo;, or <a href="/ceevee/license/">turtlebox.studio/ceevee/license</a>.</li>
        <li>Questions: <a href="/contact.html">contact us</a>. See also the <a href="/privacy.html">Turtlebox site privacy policy</a>.</li>
      </ul>
    </div>
  </section>"""
ceevee_terms = """  <div class="wrap page-head">
    <h1>CeeVee terms of use</h1>
    <p>Last updated 21 November 2026. CeeVee is sold by High Turtle LLC under the Turtlebox name.</p>
  </div>
  <section class="section" aria-label="Terms">
    <div class="wrap prose-help">
      <ol>
        <li><strong>What you get.</strong> A license to run CeeVee on up to 2 of your own computers. The price is paid once. After the 14-day trial, CeeVee is read-only (you can view and export your data) until a license is activated.</li>
        <li><strong>Your data is yours.</strong> It lives on your computer. We do not receive or sell it.</li>
        <li><strong>You are in charge of applications.</strong> CeeVee drafts documents and fills in application forms. You choose how much it may do without asking. You are responsible for what is sent in your name and for following each job site&rsquo;s rules.</li>
        <li><strong>AI can be wrong.</strong> CeeVee&rsquo;s drafts and suggestions come from a small AI model running on your computer and can contain mistakes. Read them before you rely on them.</li>
        <li><strong>Not advice.</strong> CeeVee does not give career, legal or financial advice and does not promise you a job or an interview.</li>
        <li><strong>Fair use.</strong> Do not copy, resell or share your license key, or reverse engineer CeeVee to remove the license check.</li>
        <li><strong>Third-party services.</strong> Job boards, employers, Google and others have their own terms. CeeVee does not control them.</li>
        <li><strong>Updates.</strong> CeeVee updates itself with signed files from turtlebox.studio. Updates are not tied to license status.</li>
        <li><strong>No warranty; limit of liability.</strong> CeeVee is provided as is. To the extent the law allows, our liability is limited to the price you paid.</li>
        <li><strong>Refunds.</strong> See the <a href="/refund.html">refund policy</a>.</li>
        <li><strong>Contact.</strong> <a href="/contact.html">Contact us</a>. See also the <a href="/terms.html">Turtlebox site terms</a>.</li>
      </ol>
    </div>
  </section>"""

desc_home = "Turtlebox makes Backer, CeeVee and Golden: desktop apps for Mac and Windows that keep your files on your computer. Each is a single purchase."
w("index.html", page("Turtlebox | Backer, CeeVee and Golden", desc_home, home, "/"))
w("apps/index.html", page("Apps | Turtlebox", "Backer, CeeVee and Golden: desktop apps for Mac and Windows from Turtlebox.", apps_page, "/apps/", nav_current="apps"))
w("ceevee/index.html", page("CeeVee job search app | Turtlebox", by_slug["ceevee"]["tagline"] + " " + by_slug["ceevee"]["description"], app_page("ceevee"), "/ceevee/", nav_current="ceevee"))
w("golden/index.html", page("Golden retirement planning app | Turtlebox", by_slug["golden"]["tagline"] + " " + by_slug["golden"]["description"], app_page("golden"), "/golden/", nav_current="golden"))
w("ceevee/buy/index.html", page("Buy CeeVee | Turtlebox", "Buy CeeVee: $19.99 once for 2 computers.", ceevee_buy, "/ceevee/buy/", robots=False, nav_current="ceevee"))
w("ceevee/license/index.html", page("Your CeeVee license | Turtlebox", "Find your CeeVee license key and move it to another computer.", ceevee_license, "/ceevee/license/", robots=False, nav_current="ceevee"))
w("ceevee/help/index.html", page("CeeVee help | Turtlebox", "Install CeeVee, get started, manage your license and fix common problems.", ceevee_help, "/ceevee/help/", nav_current="ceevee"))
w("ceevee/privacy/index.html", page("CeeVee privacy notice | Turtlebox", "What CeeVee keeps on your computer, what it sends, and how its optional Google sign-in uses your Gmail.", ceevee_privacy, "/ceevee/privacy/", nav_current="ceevee"))
w("ceevee/terms/index.html", page("CeeVee terms of use | Turtlebox", "Terms for using CeeVee.", ceevee_terms, "/ceevee/terms/", nav_current="ceevee"))
w("checkout/index.html", page("Checkout | Turtlebox", "Paddle checkout for Turtlebox apps.", checkout_body, "/checkout/", robots=False))
w("download-sent.html", page("Check your inbox | Turtlebox", "Download link sent.", sent, "/download-sent.html", robots=False))
w("download-problem.html", page("Download problem | Turtlebox", "Download problem.", prob, "/download-problem.html", robots=False))
w("404.html", page("Page not found | Turtlebox", "Page not found.", nf, "/404.html", robots=False))
w("robots.txt", "User-agent: *\nAllow: /\n\nSitemap: https://turtlebox.studio/sitemap.xml\n")
urls = ["/", "/apps/", "/backer/", "/backer/releases.html", "/backer/notes.html", "/ceevee/", "/ceevee/help/", "/ceevee/privacy/", "/ceevee/terms/", "/golden/",
        "/terms.html", "/refund.html", "/privacy.html", "/contact.html"]
w("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + "".join(f"  <url><loc>https://turtlebox.studio{u}</loc></url>\n" for u in urls) + "</urlset>\n")
fav = open(os.path.join(HERE, "design-system", "assets", "Icons", "favicon.svg")).read()
w("favicon.svg", fav)
print("built")
