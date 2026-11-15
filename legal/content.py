"""Shared legal and pricing copy for turtlebox.studio and highturtle.com.

DRAFTS for the owner to review (ideally with a lawyer). Not legal advice.
Anything in a yellow [bracket] is a placeholder that must be replaced before launch.
Values come from backer/config.json; see backer/HOSTING.md.
"""
import html

UPDATED = "November 15, 2026"
PLACEHOLDERS = set()

def ph(label):
    PLACEHOLDERS.add(label)
    return f'<mark style="background:#fff3a3;color:#000;padding:0 .2em">[{html.escape(label)}]</mark>'

def val(cfg, key, label):
    v = (cfg.get(key) or "").strip()
    return html.escape(v) if v else ph(label)

def ctx(cfg, brand, domain, email, ext):
    return {
        "ext": ext, "brand": brand, "domain": domain, "email": email,
        "company": val(cfg, "company_legal_name", "LEGAL ENTITY NAME"),
        "address": val(cfg, "company_address", "BUSINESS ADDRESS"),
        "country": val(cfg, "governing_law", "GOVERNING LAW, e.g. State of Texas, USA"),
        "price": val(cfg, "price_display", "PRICE, e.g. $29 USD"),
        "devices": val(cfg, "devices_per_key", "NUMBER OF COMPUTERS PER KEY"),
        "refund_days": val(cfg, "refund_days", "REFUND WINDOW IN DAYS, e.g. 30"),
    }

def h2(t): return f'<h2 style="font-size:1.5rem;margin-top:2.5rem">{t}</h2>'

def draft_note():
    return ('<p style="font-size:1rem"><mark style="background:#fff3a3;color:#000;padding:0 .2em">'
            'DRAFT for owner review. Remove this notice once reviewed.</mark></p>')

def pricing_body(c, buy_button):
    return f"""  <div class="wrap page-head">
    <h1>Pricing</h1>
    <p>Backer is a desktop app for macOS and Windows that backs up your photos and videos to a NAS you own. One price, paid once.</p>
  </div>
  <section class="section" style="border-top:0">
    <div class="wrap">
      <div class="app-card" style="max-width:34rem">
        <h2 style="font-size:1.75rem">Backer license</h2>
        <p style="font-size:2rem;margin-top:.5rem">{c['price']} <span style="font-size:1rem">one-time, taxes calculated at checkout</span></p>
        <ul style="margin:1rem 0 0;padding-left:1.2em;display:grid;gap:.5rem">
          <li>One license key covers all 1.x versions. No subscription, no renewal.</li>
          <li>Use it on up to {c['devices']}.</li>
          <li>Free 14-day trial with every feature, no card needed.</li>
          <li>macOS 13 or newer (Apple silicon) and 64-bit Windows.</li>
          <li>After the trial, new backups stop. Your history, Verify and restore keep working.</li>
          <li>Backed by our <a href="/refunds{c['ext']}">refund policy</a>.</li>
        </ul>
        <div class="action" style="margin-top:1.5rem">{buy_button}</div>
        <p class="fine" style="margin-top:1rem;font-size:.875rem">Payments are handled by Paddle, our reseller and merchant of record. Your license key arrives by email after purchase. See the <a href="/terms{c['ext']}">terms</a> and <a href="/privacy{c['ext']}">privacy policy</a>.</p>
      </div>
      <h2 style="font-size:1.5rem;margin-top:3rem">What Backer does</h2>
      <p style="max-width:34em;margin-top:1rem">Backer copies your photo and video folders from a Mac or PC to a Synology or other NAS you own, on a schedule or on demand. It handles 100,000+ files, verifies copies against your originals, and never deletes anything on the NAS without asking. It runs on your computer: there is no cloud storage and no account.</p>
    </div>
  </section>"""

def terms_body(c):
    b, d = c["brand"], c["domain"]
    return f"""{draft_note()}
    <h1>Terms of service</h1>
    <p>Last updated {UPDATED}</p>
    <p>These terms cover your use of {d} and the Backer desktop app (together, the &ldquo;Service&rdquo;). The Service is provided by {c['company']}, trading as High Turtle and Turtlebox (&ldquo;we&rdquo;, &ldquo;us&rdquo;), {c['address']}. By using the Service or buying a license you agree to these terms.</p>
    {h2('The product')}
    <p>Backer is software that copies files from your computer to a network storage device you own. We do not store your files. You are responsible for your data, for the NAS you back up to, and for checking that your backups work.</p>
    {h2('License')}
    <p>When you buy a license we grant you a personal, non-exclusive, non-transferable license to install and use Backer on up to {c['devices']}, for all 1.x versions. You may not resell, share or publish your license key, or reverse engineer the software except as the law allows. The 14-day trial is free and includes every feature; we may change or end the trial offer at any time.</p>
    {h2('Purchases and payment')}
    <p>Our order process is run by Paddle.com, our reseller and merchant of record. Paddle handles payment, invoicing, sales tax and VAT, and your purchase is also subject to <a href="https://www.paddle.com/legal/checkout-buyer-terms">Paddle&rsquo;s checkout buyer terms</a>. Prices are shown before you pay. Backer is a one-time purchase, not a subscription.</p>
    {h2('Refunds')}
    <p>See our <a href="/refunds{c['ext']}">refund policy</a>.</p>
    {h2('Acceptable use')}
    <p>Do not use the Service to break the law, to access data you have no right to copy, or to interfere with the Service or other people&rsquo;s systems.</p>
    {h2('No warranty')}
    <p>Backups are only as reliable as your computer, network and storage. The Service is provided &ldquo;as is&rdquo; without warranties of any kind, to the extent the law allows. Keep more than one copy of anything you cannot replace.</p>
    {h2('Limit of liability')}
    <p>To the extent the law allows, our total liability for any claim relating to the Service is limited to the amount you paid for your license, and we are not liable for lost data, lost profits or indirect damages. Nothing here limits rights you have under consumer law that cannot be waived.</p>
    {h2('Changes and ending')}
    <p>We may update these terms; the date above shows the latest version. We may end a license that is used in breach of these terms. Your right to the version you bought continues unless that happens.</p>
    {h2('Governing law')}
    <p>These terms are governed by the law of {c['country']}, without affecting any mandatory consumer rights where you live.</p>
    {h2('Contact')}
    <p>Questions: <a href="mailto:{c['email']}">{c['email']}</a>.</p>
    <a class="btn" href="/">Back to {b}</a>"""

def refunds_body(c):
    return f"""{draft_note()}
    <h1>Refund policy</h1>
    <p>Last updated {UPDATED}</p>
    <p>We want you to be happy with Backer. Try it free for 14 days with every feature before you buy.</p>
    {h2('Money-back guarantee')}
    <p>If you are not satisfied, ask for a refund within {c['refund_days']} days of your purchase and we will refund the full price. No questions asked.</p>
    {h2('How to ask')}
    <p>Email <a href="mailto:{c['email']}">{c['email']}</a> from the address you bought with, or include your order number. You can also request a refund at <a href="https://paddle.net">paddle.net</a>. Because Paddle is our merchant of record, the refund is issued by Paddle to your original payment method. It usually appears within 5 to 10 business days.</p>
    {h2('After the refund window')}
    <p>Outside that window we may still refund where the law requires it, for example if the software does not work as described and we cannot fix it, or if you were charged by mistake.</p>
    {h2('What happens to your license')}
    <p>A refunded license key is deactivated. The free trial is not available again on the same computer.</p>
    <a class="btn" href="/">Back to {c['brand']}</a>"""

def privacy_extra(c):
    """Sections about purchases, added to each site's privacy page."""
    return f"""    {h2('Purchases')}
    <p>If you buy Backer, payment is handled by Paddle.com, our merchant of record. Paddle collects your name, email, billing country, tax details and payment information to process the order, and acts as the controller of that data under <a href="https://www.paddle.com/legal/privacy">Paddle&rsquo;s privacy policy</a>. We receive your email address, country and order details so we can send your license key, provide support and keep records. We do not see your card number.</p>
    {h2('Cookies on checkout')}
    <p>The pages on this website set no cookies of their own. When you open the checkout, Paddle&rsquo;s script loads from Paddle&rsquo;s servers and may set cookies or similar storage needed to take payment and prevent fraud.</p>
    {h2('The Backer app')}
    <p>Backer sends nothing anywhere except update checks to our server and license activation. There is no telemetry and your files never leave your computer and your NAS.</p>
    {h2('Your rights and contact')}
    <p>You can ask us to access, correct or delete the personal data we hold about you. Write to <a href="mailto:{c['email']}">{c['email']}</a>. The data controller is {c['company']}, {c['address']}.</p>"""

def privacy_body(c):
    return f"""{draft_note()}
    <h1>Privacy</h1>
    <p>Last updated {UPDATED}</p>
    <p>High Turtle and Turtlebox are run by {c['company']}. We collect your email address when you join the list or ask for an app download, and order details when you buy Backer. This page says what we do with them.</p>
    {h2('What we collect')}
    <p>Your email address and the time you confirmed it. The site does not use analytics.</p>
    {h2('How we use it')}
    <p>We send the sample skill, download links, and news about High Turtle and Turtlebox releases. Asking for an app download also adds you to the High Turtle list. We do not sell, rent or share your address with anyone else.</p>
    {h2('Where it is kept')}
    <p>In Amazon Web Services (Amazon SES and DynamoDB), in the United States. A signup you never confirm is deleted after 48 hours.</p>
    {h2('Leaving')}
    <p>Every email has an unsubscribe link that works in one step. To have your address deleted, write to {c['email']} and we will remove it.</p>
{privacy_extra(c)}
    <a class="btn" href="/">Back to {c['brand']}</a>"""
