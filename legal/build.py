#!/usr/bin/env python3
"""Builds the policy pages Paddle asks for on both sites, and the footer that links to them.

  python3 legal/build.py           write terms, refund, privacy and contact pages for highturtle.com (repo root)
                                   and turtlebox.studio (turtlebox/), refresh the footers on the static High Turtle
                                   pages, then rebuild the Turtlebox and Backer pages so their footers match
  python3 legal/build.py --check   list every [placeholder] still showing on either site; exits 1 if any remain

Business details live in legal/config.json. See legal/README.md for what Paddle checks.
"""
import glob, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from site_legal import CFG, SITES, v, email, footer_block, replace_footer_block  # noqa: E402

mark_svg = open(os.path.join(ROOT, "assets", "mark.svg")).read()
MARK_PATH = re.search(r"<path[^>]*/>", mark_svg).group(0)
MARK_VB = re.search(r'viewBox="([^"]+)"', mark_svg).group(1)
TB_V = re.search(r'V = "(\w+)"', open(os.path.join(ROOT, "turtlebox", "build.py")).read()).group(1)

PADDLE_BUYER_TERMS = "https://www.paddle.com/legal/checkout-buyer-terms"
PADDLE_PRIVACY = "https://www.paddle.com/legal/privacy"

STYLE = """<style>
  .legal { padding-block: 4rem; max-width: 46rem; }
  .legal h1 { font-size: clamp(2.25rem, 5vw, 3.25rem); font-weight: 300; letter-spacing: -0.03em; line-height: 1.1; }
  .legal .updated { margin-top: 0.75rem; font-size: 0.875rem; }
  .legal h2 { font-size: 1.375rem; line-height: 1.3; margin-top: 2.5rem; }
  .legal p, .legal li { margin-top: 0.75rem; line-height: 1.65; }
  .legal ul { padding-left: 1.25rem; list-style: disc; }
  .legal .box { margin-top: 1.5rem; padding: 1rem 1.25rem; border: 1px solid var(--line); }
  .legal-links a { white-space: nowrap; }
</style>"""


def shell(site, title, desc, path, body):
    s = SITES[site]
    if site == "highturtle":
        html_open, scheme = '<html lang="en">', '<meta name="color-scheme" content="light dark">'
        css = '<link rel="stylesheet" href="/assets/styles.css?v=hc1">'
        nav = ('<a href="/#companies">Companies</a>\n'
                              '        <a href="/contact.html">Contact</a>')
        foot_intro = "<p>High Turtle LLC is a holding company for AI companies.</p>"
    else:
        html_open, scheme = ('<html lang="en" data-theme="light">',
                             '<meta name="color-scheme" content="light">\n  <meta name="theme-color" content="#F5F0E7">')
        css = f'<link rel="stylesheet" href="/assets/styles.css?v={TB_V}">'
        nav = ('<a href="/apps/">Apps</a>\n        <a href="/backer/">Backer</a>\n'
               '        <a href="https://highturtle.com">High Turtle</a>')
        foot_intro = "<p>Turtlebox builds small AI apps.</p>"
    return f"""<!doctype html>
{html_open}
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  {scheme}
  <title>{title} | {s["brand"]}</title>
  <meta name="description" content="{desc}">
  <link rel="canonical" href="https://{s["domain"]}{path}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/assets/fonts/Inter-Light.woff2" as="font" type="font/woff2" crossorigin>
  {css}
  {STYLE}
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><symbol id="mark" viewBox="{MARK_VB}">{MARK_PATH}</symbol></svg>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="{s["brand"]} home">
      <svg class="brand-mark" viewBox="{MARK_VB}" aria-hidden="true"><use href="#mark"/></svg>
      <span class="brand-name">{s["brand"]}</span>
    </a>
    <nav aria-label="Main">
        {nav}
    </nav>
  </div>
</header>
<main id="main" class="legal wrap">
{body}
</main>
<footer class="site-footer">
  <div class="wrap foot">
      {foot_intro}
      {footer_block(site)}
  </div>
</footer>
</body>
</html>
"""


MOR = ("Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record "
       "for all our orders. Paddle provides all customer service inquiries and handles returns.")


def products(site):
    if site == "highturtle":
        return f"""<h2>3. Our companies and their products</h2>
<p>High Turtle LLC is a holding company. It owns and operates AI companies that trade under their own names, such as <a href="https://turtlebox.studio">Turtlebox</a>. Nothing is sold on highturtle.com. Each company sells its products on its own website, and the terms, refund policy and prices on that website apply to those products. High Turtle does not sell consulting or other services.</p>
<p>If High Turtle itself ever sells a product, its page will say what is included and the price, and you will get a personal, non-exclusive, non-transferable license to use it in your own work. You may not resell, sublicense, share publicly or redistribute it."""
    return f"""<h2>3. What you buy</h2>
<p>Turtlebox makes software: small AI apps that run in your browser, and <a href="/backer/">Backer</a>, a desktop app that backs up photos and videos from a Mac or PC to a NAS. Each app's page says what it does, what it costs and what is included. Turtlebox does not sell consulting or other services.</p>
<p><strong>Backer licenses.</strong> Backer is free to try for 14 days. A purchase gives you a license key, sent by email and shown on your order confirmation, that unlocks Backer and covers all 1.x versions. The license is personal, non-exclusive and non-transferable. You may not share your key publicly, resell it, or try to get around the license check.</p>
<p><strong>Your data and backups.</strong> Backer copies files you choose to storage you own. It never deletes files on your NAS without asking, but no backup tool can rule out every failure, so keep more than one copy of anything you cannot replace and use Verify to check your backups."""


def ai_section(site):
    what = "companies' products use AI models to produce results" if site == "highturtle" else "apps use AI models to produce results"
    return f"""<h2>5. AI features and outputs</h2>
<p>Some of our {what}. If you use them:</p>
<ul>
<li>You are responsible for what you put in (your prompts, files and data), for having the rights to use it, and for how you use what comes out.</li>
<li>AI output can be wrong, incomplete or out of date. Check it before you rely on it. It is not legal, medical, financial or other professional advice, and should not be used for decisions in those areas without review by a qualified person.</li>
<li>You must not use them to create or share illegal content, sexual content involving anyone without their consent (including deepfakes), hate speech or harassment, malware, content that reveals someone's private information (doxxing), or content meant to deceive people, and you must not try to get around the safety rules of the AI models they use (jailbreaking).</li>
<li>Where we host content, we may remove anything that breaks these rules. To report content that infringes your rights, write to {email(site)} and we will review it promptly.</li>
</ul>"""


def terms(site):
    s = SITES[site]
    return f"""<h1>Terms of service</h1>
<p class="updated">Last updated {CFG["effective_date"]}</p>

<h2>1. Who we are</h2>
<p>{s["domain"]} and the {s["brand"]} products are provided by {v("legal_name")} ("we", "us"), trading as {s["brand"]}, of {v("address")}. When you buy or use a {s["brand"]} product, your contract is with {v("legal_name")}.</p>
<p>You can reach us at {email(site)}.</p>

<h2>2. Accepting these terms</h2>
<p>By using this website or our products, you agree to these terms. If you do not agree, do not use them. If you use our products for an organization, you confirm you can accept these terms on its behalf.</p>

{products(site)}</p>

<h2>4. Ordering and payment</h2>
<p class="box">{MOR}</p>
<p>Prices are shown on each product page. Paddle calculates any sales tax or VAT at checkout and takes payment. Billing, taxes, cancellations and refunds are covered by <a href="{PADDLE_BUYER_TERMS}">Paddle's buyer terms</a>, which you accept at checkout. Our <a href="/refund.html">refund policy</a> explains how to get your money back.</p>

{ai_section(site)}

<h2>6. Using the site and products properly</h2>
<p>You must not use this website or our products:</p>
<ul>
<li>for anything unlawful, or to commit fraud or send spam;</li>
<li>to infringe anyone's intellectual property or other rights;</li>
<li>to interfere with their security, including uploading malware, probing or scanning for weaknesses, scraping, overloading them, or trying to get around access or license controls.</li>
</ul>

<h2>7. Ownership</h2>
<p>We own the website, our products and everything in them, including software, text, designs and the {s["brand"]} name and logo. Buying a product gives you a license to use it as described above, not ownership of it.</p>

<h2>8. No guarantee of availability</h2>
<p>We work to keep the website and products running well, but we do not promise they will always be available, uninterrupted or error-free. We may change or stop offering a product. If we stop a product you have paid for and cannot use any more, contact us.</p>

<h2>9. Suspension and termination</h2>
<p>We may suspend or end your access to a product, or cancel a license, if you materially break these terms, if a payment is not made or is reversed, if your use creates a security or fraud risk, or for repeated or serious violations. You can stop using our products at any time.</p>

<h2>10. Warranties and liability</h2>
<p>Apart from what these terms say and what the law requires, our products are provided "as is", without warranties of any kind. To the extent the law allows, we are not liable for indirect or consequential loss, or for loss of data, profits or business, and our total liability for any claim is limited to the amount you paid us for the product in the 12 months before the claim. Nothing in these terms limits rights you have under consumer law that cannot be excluded.</p>

<h2>11. Governing law</h2>
<p>These terms are governed by the laws of {v("governing_law")}. If you are a consumer, you also keep the protection of the laws of the country where you live.</p>

<h2>12. Changes</h2>
<p>We may update these terms. The date at the top shows the latest version. Changes do not affect purchases already made.</p>

<h2>13. Contact</h2>
<p>Questions about these terms: {email(site)}. For help with an order or a payment, visit <a href="https://paddle.net">paddle.net</a>.</p>"""


def refund(site):
    s = SITES[site]
    key = " If you bought Backer, its license key stops working after the refund." if site == "turtlebox" else ""
    return f"""<h1>Refund policy</h1>
<p class="updated">Last updated {CFG["effective_date"]}</p>

<p class="box">If you are not happy with a {s["brand"]} purchase, you can have a full refund within <strong>{v("refund_days")} days</strong> of buying it, for any reason. No questions asked.</p>

<h2>How to ask for a refund</h2>
<p>Our orders are processed by Paddle.com, our online reseller and Merchant of Record, so Paddle handles refunds.</p>
<ul>
<li>Go to <a href="https://paddle.net">paddle.net</a>, look up your order with the email address you used, and follow the steps to request a refund; or</li>
<li>write to us at {email(site)} with your order number, and we will arrange it with Paddle.</li>
</ul>
<p>The refund goes back to the payment method you used.{key}</p>

<h2>More detail</h2>
<p>Refunds are also covered by <a href="{PADDLE_BUYER_TERMS}">Paddle's buyer terms</a>. This policy does not affect any rights you have under consumer law.</p>"""


def privacy(site):
    return f"""<h1>Privacy notice</h1>
<p class="updated">Last updated {CFG["effective_date"]}</p>

<p>This notice covers highturtle.com, turtlebox.studio, and the High Turtle and Turtlebox products, including the Backer app. We collect as little as we can.</p>

<h2>Who is responsible</h2>
<p>{v("legal_name")}, trading as High Turtle and Turtlebox, of {v("address")}, is the controller of your personal data. Privacy questions and requests: <a href="mailto:{CFG["highturtle_email"]}">{CFG["highturtle_email"]}</a> or <a href="mailto:{CFG["turtlebox_email"]}">{CFG["turtlebox_email"]}</a>.</p>

<h2>What we collect, why, and for how long</h2>
<ul>
<li><strong>Email list.</strong> Your email address and when you confirmed it, so we can send news about High Turtle and Turtlebox releases. Legal basis: your consent. Kept until you unsubscribe. A signup you never confirm is deleted after 48 hours. After you unsubscribe, your address stays on a suppression list only so we never email you again.</li>
<li><strong>App downloads.</strong> Your email address and the app you asked for, so we can email you a download link. Asking for a download also adds you to the email list, as the form says. Legal basis: your consent.</li>
<li><strong>Purchases.</strong> Paddle, our Merchant of Record, collects your name, email, billing address, country and payment details at checkout and shares the order details with us (name, email, country, what you bought and your license key). We use them to deliver your purchase, give support and keep business records. Legal basis: to perform our contract with you, and our legal obligations for tax and accounting. Kept for as long as tax and accounting law requires. We never see your full card details.</li>
<li><strong>Issue reports.</strong> What you type into the Backer report form: a summary, details, your computer type, Backer version, NAS model, and your email if you add one so we can reply. We use it to fix problems and answer you. Legal basis: our legitimate interest in supporting and improving our products. Kept while the issue is open and for up to 2 years after, so we can spot repeat problems.</li>
<li><strong>Emails you send us.</strong> Your message and address, to answer you. Legal basis: our legitimate interest in replying. Kept for up to 2 years after the conversation ends.</li>
<li><strong>The Backer app.</strong> Backer checks our server for updates. Like any web request, this sends your IP address and the app's version. Backer sends no telemetry, and your files and backups never leave your computer and NAS.</li>
<li><strong>Website visits.</strong> Our sites set no cookies and use no analytics or tracking scripts. Our hosting provider handles your IP address to deliver pages and may keep short-lived logs for security.</li>
</ul>

<h2>Who we share it with</h2>
<p>We do not sell or rent your personal data. We share it only with:</p>
<ul>
<li><strong>Paddle.com</strong>, our online reseller and Merchant of Record, which processes orders, payments, taxes and refunds. Paddle uses your data as described in <a href="{PADDLE_PRIVACY}">its privacy notice</a>.</li>
<li><strong>Service providers</strong> that run things for us: Amazon Web Services (hosting, email sending and storage, in the United States), GitHub (our private issue tracker, for issue reports) and MXroute (our email inbox).</li>
<li><strong>Professional advisers</strong>, such as accountants and lawyers, when needed.</li>
<li><strong>Authorities</strong>, when the law requires it.</li>
</ul>

<h2>International transfers</h2>
<p>Our service providers store data in the United States. Where data from the UK or the European Economic Area is transferred, we rely on an adequacy decision or the standard contractual clauses (or the UK addendum) that these providers offer.</p>

<h2>Your rights</h2>
<p>Depending on where you live, you can ask us to give you a copy of your data, correct it, delete it, restrict or object to how we use it, or move it to another service. Where we rely on consent, you can withdraw it at any time, for example with the unsubscribe link in every email. Write to us to use any of these rights and we will answer within one month. You can also complain to your local data protection authority. California and other US state residents have similar rights, and we do not sell or share personal data for advertising.</p>

<h2>Security</h2>
<p>We protect your data with encryption in transit, access controls and providers with strong security practices, and we keep only what we need.</p>

<h2>Cookies</h2>
<p>Our own pages set no cookies. Paddle's checkout may use cookies it needs to process your payment safely; those are covered by Paddle's privacy notice.</p>

<h2>Children</h2>
<p>Our products are not meant for children under 16, and we do not knowingly collect their data.</p>

<h2>Changes</h2>
<p>We may update this notice. The date at the top shows the latest version.</p>"""


def contact(site):
    s = SITES[site]
    extra = ('<p>Problem with Backer? You can also <a href="/backer/report.html">report an issue</a>.</p>'
             if site == "turtlebox" else
             f'<p>Questions about a Turtlebox app or order: email {email("turtlebox")}.</p>')
    return f"""<h1>Contact</h1>
<p class="updated">We usually reply within two business days.</p>

<h2>Questions and support</h2>
<p>Email {email(site)}.</p>
{extra}
<h2>Orders, payments and refunds</h2>
<p>Our orders are processed by Paddle.com, our online reseller and Merchant of Record. To find an order, get a receipt or ask for a refund, visit <a href="https://paddle.net">paddle.net</a>, or write to us and we will help. See our <a href="/refund.html">refund policy</a>.</p>

<h2>Business details</h2>
<p>{s["brand"]} is a trading name of {v("legal_name")}.<br>{v("address")}</p>"""


PAGES = [
    ("terms.html", "Terms of service", "The terms for using {brand} and buying its products.", terms),
    ("refund.html", "Refund policy", "How to get a refund for a {brand} purchase.", refund),
    ("privacy.html", "Privacy notice", "What personal data {brand} collects and how it is used.", privacy),
    ("contact.html", "Contact", "How to reach {brand}.", contact),
]


def build():
    for site, out in (("highturtle", ROOT), ("turtlebox", os.path.join(ROOT, "turtlebox"))):
        for fname, title, desc, fn in PAGES:
            page = shell(site, title, desc.format(brand=SITES[site]["brand"]), "/" + fname, fn(site))
            open(os.path.join(out, fname), "w").write(page)
    # Static High Turtle pages carry a marked footer block; refresh it.
    for f in glob.glob(os.path.join(ROOT, "*.html")):
        t = open(f).read()
        n = replace_footer_block(t, "highturtle")
        if n != t:
            open(f, "w").write(n)
    subprocess.run([sys.executable, os.path.join(ROOT, "turtlebox", "build.py")], check=True)
    subprocess.run([sys.executable, os.path.join(ROOT, "backer", "build.py")], check=True)
    print("Policy pages and footers built for highturtle.com and turtlebox.studio")


def check():
    files = glob.glob(os.path.join(ROOT, "*.html")) + glob.glob(os.path.join(ROOT, "turtlebox", "**", "*.html"), recursive=True)
    found = {}
    for f in files:
        if "/design-system/" in f:
            continue
        for label in re.findall(r'class="todo"[^>]*>\[([^\]]+)\]', open(f).read()):
            found.setdefault(label, set()).add(os.path.relpath(f, ROOT))
    if not found:
        print("No placeholders left."); return 0
    print("Placeholders still showing:")
    for label, fs in sorted(found.items()):
        print(f"  [{label}]  in {len(fs)} page(s): {', '.join(sorted(fs)[:4])}{' …' if len(fs) > 4 else ''}")
    return 1


if __name__ == "__main__":
    sys.exit(check() if "--check" in sys.argv else build())
