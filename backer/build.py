#!/usr/bin/env python3
"""Builds the Backer pages that live at turtlebox.studio/backer/.

  python3 backer/build.py                 build into turtlebox/backer/ (values missing from backer/config.json show as 'Coming soon')
  python3 backer/build.py --artifact DIR  write review copies into DIR (placeholders left visible, Google Fonts, inline CSS)

Config values:
  base_url        update hosting address, ending in /backer, for example https://dxxxx.cloudfront.net/backer
  checkout_url    Paddle checkout link for "Buy now" (the old key fastspring_url is still read)
  price           Backer's price as shown on the page, for example $29
  support_email   support address shown on the pages
The footer's legal name and policy links come from legal/config.json.
Pages are light only. Unset download and checkout links show as "Coming soon"; an unset price shows a highlighted placeholder.
"""
import json, os, re, shutil, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "turtlebox")
V = "bk2"
sys.path.insert(0, os.path.join(ROOT, "legal"))
from site_legal import footer_block, todo  # policy links and legal name (Paddle requirements)
sys.path.insert(0, OUT)
from nav import nav_links  # same menu as the other Turtlebox pages
from gtag import add_tag  # Google tag on every Turtlebox page
from showcase import gallery, feature_groups, BACKER_FEATURES  # screenshots and feature list, shared with the other app pages
TB_V = re.search(r'V = "(\w+)"', open(os.path.join(OUT, "build.py")).read()).group(1)  # same cache tag as the Turtlebox pages

mark_svg = open(os.path.join(ROOT, "assets", "mark.svg")).read()
MARK_PATH = re.search(r"<path[^>]*/>", mark_svg).group(0)
MARK_VB = re.search(r'viewBox="([^"]+)"', mark_svg).group(1)
icon_svg = open(os.path.join(HERE, "icon-placeholder.svg")).read()
ICON_INNER = re.sub(r"^<svg[^>]*>|</svg>$", "", icon_svg.strip())
CSS = open(os.path.join(HERE, "backer.css")).read()

TB_CSS = open(os.path.join(OUT, "assets", "styles.css")).read()
GFONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
          '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap">')

DETECT = '''<script>
/* Mark the visitor's OS before first paint so the right download comes first. Both downloads stay available. */
(function () {
  var os = 'other';
  try {
    var ua = navigator.userAgent || '';
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var touch = navigator.maxTouchPoints > 1;
    if (/Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(p) && touch)) os = 'other';
    else if (/Win/i.test(p) || /Windows/i.test(ua)) os = 'win';
    else if (/Mac/i.test(p) || /Mac OS X/i.test(ua)) os = 'mac';
  } catch (e) {}
  document.documentElement.setAttribute('data-os', os);
})();
</script>'''

HEADER = f'''<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="Turtlebox home">
      <svg class="brand-mark" viewBox="{MARK_VB}" aria-hidden="true"><use href="#mark"/></svg>
      <span class="brand-name">Turtlebox</span>
    </a>
    <nav aria-label="Main">
      {nav_links("backer", TB_V)}
    </nav>
  </div>
</header>'''

def footer(extra=""):
    return f'''<footer class="site-footer">
  <div class="wrap">
    <p class="bk-privacy"><strong>Privacy.</strong> Backer sends nothing anywhere except update checks to our server and the purchase page. There is no telemetry. This website has no tracking scripts and sets no cookies unless you sign in to your account.</p>
    <div class="foot" style="margin-top:var(--space-sm)">
      <p><a href="/backer/releases.html">Releases</a> &middot; <a href="/backer/notes.html">Release notes</a> &middot; <a href="/backer/report.html">Report an issue</a> &middot; <a href="/apps/">Apps</a> &middot; <a href="https://highturtle.com">High Turtle</a></p>
      {footer_block("turtlebox")}
    </div>{extra}
  </div>
</footer>'''

SPRITES = f'<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><symbol id="mark" viewBox="{MARK_VB}">{MARK_PATH}</symbol><symbol id="icon" viewBox="0 0 64 64">{ICON_INNER}</symbol></svg>'

VERSION_JS = '''<script>
/* Show the current version from latest.json. If the request fails, the version stays hidden. */
(function () {
  var base = '{{BASE_URL}}';
  if (!window.fetch || !base || base.indexOf('{{') === 0) return;
  var ctl = window.AbortController ? new AbortController() : null;
  var timer = ctl ? setTimeout(function () { ctl.abort(); }, 4000) : null;
  fetch(base + '/latest.json', { cache: 'no-cache', signal: ctl ? ctl.signal : undefined })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (j) {
      var v = j && typeof j.version === 'string' ? j.version.trim() : '';
      if (!/^[0-9A-Za-z.+-]{1,32}$/.test(v)) return;
      document.getElementById('version').textContent = v;
      document.getElementById('version-wrap').hidden = false;
    })
    .catch(function () {})
    .then(function () { if (timer) clearTimeout(timer); });
})();
</script>'''

PADDLE_JS = '''<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>
<script>
/* Paddle checkout (overlay). The client-side token and price ID are public by design. If Paddle.js does not
   load, the Buy buttons fall back to the pricing section. */
(function () {
  if (!window.Paddle) return;
  Paddle.Initialize({ token: '{{TOKEN}}' });
  document.querySelectorAll('[data-paddle-buy]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault();
      Paddle.Checkout.open({
        items: [{ priceId: '{{PRICE_ID}}', quantity: 1 }],
        settings: { displayMode: 'overlay', theme: 'light', successUrl: 'https://turtlebox.studio/backer/thanks.html' }
      });
    });
  });
})();
</script>'''

INDEX = '''
  <main id="main">
    <section class="bk-hero" id="download"><div class="wrap">
      <p class="eyebrow"><svg aria-hidden="true"><use href="#icon"/></svg>Backer, a Turtlebox app</p>
      <h1>Back up your photos and videos.</h1>
      <p class="lede">Backer copies your photo and video folders from a Mac or PC to a Synology or other NAS you own, on a schedule or on demand. <strong>It never deletes anything on the NAS without asking.</strong> No cloud, no subscription.</p>

      <div class="buy">
        <a class="btn btn-buy" href="{{CHECKOUT_URL}}" data-paddle-buy>Buy Backer &middot; {{PRICE}}</a>
        <p class="buy-note">One-time purchase. One license key covers every 1.x version, on macOS and Windows. <a href="#pricing">What you get</a></p>
      </div>

      <h2 class="try-h">Not sure yet? Try it free for 14 days.</h2>
      <div class="downloads downloads-trial">
        <div class="dl dl-mac">
          <h2>macOS <span class="rec">For this computer</span></h2>
          <p class="req">macOS 13 or newer · Apple silicon</p>
          <p class="note">Signed and notarized by Apple. Not available for Intel Macs.</p>
          <a class="btn" href="{{BASE_URL}}/download/Backer-macOS-arm64.dmg">Download for macOS</a>
          <p class="file">Backer-macOS-arm64.dmg</p>
        </div>
        <div class="dl dl-win">
          <h2>Windows <span class="rec">For this computer</span></h2>
          <p class="req">Windows 64-bit</p>
          <p class="note">The installer is not code-signed yet, so Windows may warn you. <a href="#install">What to expect</a>.</p>
          <a class="btn" href="{{BASE_URL}}/download/Backer-Windows-x64-setup.exe">Download for Windows</a>
          <p class="file">Backer-Windows-x64-setup.exe</p>
        </div>
      </div>
      <div class="meta">
        <span id="version-wrap" hidden>Version <span id="version"></span></span>
        <span>The trial has every feature. Enter your key any time to keep backing up.</span>
      </div>
    </div></section>

'''+ gallery("backer", "Backer") + '''

    <section class="section" id="features" aria-labelledby="features-h"><div class="wrap">
      <h2 id="features-h">What Backer does</h2>
      '''+ feature_groups(BACKER_FEATURES) + '''
    </div></section>

    <section class="section" id="pricing" aria-labelledby="pricing-h"><div class="wrap">
      <h2 id="pricing-h">Pricing</h2>
      <div class="price">
        <div>
          <h3>One-time purchase</h3>
          <p class="amount"><strong>{{PRICE}}</strong> once, in US dollars. Any sales tax or VAT is added at checkout.</p>
          <ul>
            <li><strong>One key covers all 1.x versions.</strong> No subscription.</li>
            <li><strong>14-day free trial</strong> with every feature.</li>
            <li>After the trial, backups stop. Your history, Verify and restore keep working.</li>
          </ul>
          <h3 style="margin-top:var(--space-md)">What you get</h3>
          <ul>
            <li>A license key by email, right after you buy</li>
            <li>Backer for macOS (Apple silicon) and Windows 64-bit</li>
            <li>Every 1.x update, delivered in the app</li>
            <li>Email support at {{SUPPORT_EMAIL}}</li>
          </ul>
        </div>
        <a class="btn btn-buy" href="{{CHECKOUT_URL}}" data-paddle-buy>Buy now</a>
      </div>
      <p class="fine" style="margin-top:var(--space-sm)">Orders are processed by Paddle.com, our online reseller and Merchant of Record. <a href="/refund.html">Refund policy</a> &middot; <a href="/terms.html">Terms</a></p>
    </div></section>

    <section class="section" id="install" aria-labelledby="install-h"><div class="wrap">
      <h2 id="install-h">Install</h2>
      <div class="cols">
        <div>
          <h3>macOS</h3>
          <p>Open the DMG and drag <strong>Backer</strong> to <strong>Applications</strong>. The app is signed and notarized.</p>
        </div>
        <div>
          <h3>Windows</h3>
          <p>Run the installer. It is not yet code-signed, so Windows SmartScreen may say &ldquo;unknown publisher&rdquo;. Click <span class="kbd">More info</span>, then <span class="kbd">Run anyway</span>.</p>
        </div>
      </div>
    </div></section>

    <section class="section" id="help" aria-labelledby="help-h"><div class="wrap">
      <h2 id="help-h">After you buy</h2>
      <div class="prose">
      <p>Your license key appears on the confirmation page and arrives by email.</p>
      <ol class="steps">
        <li>In Backer, open <span class="kbd">Settings</span>, then <span class="kbd">License</span>.</li>
        <li>Paste the key.</li>
        <li>Click <span class="kbd">Activate</span>.</li>
      </ol>
      <p>Keys are tied to the email address you bought with. If something does not work, <a href="/backer/report.html">report an issue</a> or write to <a class="support-mail" href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>
      </div>
    </div></section>
  </main>'''

THANKS = '''
  <main id="main" class="bk-simple wrap">
    <h1>Thanks for buying Backer.</h1>
    <p class="lede">Your license key is on its way by email from Turtlebox, usually within a few minutes. Paddle, our Merchant of Record, sends the receipt separately. Here is how to turn the key on.</p>
    <ol class="steps">
      <li>Open Backer, then go to <span class="kbd">Settings</span> and <span class="kbd">License</span>.</li>
      <li>Paste the key.</li>
      <li>Click <span class="kbd">Activate</span>.</li>
    </ol>
    <p class="lede">Keys are tied to the email address you bought with, and one key covers all 1.x versions.</p>
    <p>See your purchases and invoices any time in <a href="/account/">your account</a> (sign in with Google).</p>
    <div class="downloads" style="width:100%">
      <div class="dl dl-mac">
        <h2>macOS</h2>
        <p class="req">macOS 13 or newer · Apple silicon</p>
        <p class="note">Open the DMG and drag Backer to Applications.</p>
        <a class="btn" href="{{BASE_URL}}/download/Backer-macOS-arm64.dmg">Download for macOS</a>
      </div>
      <div class="dl dl-win">
        <h2>Windows</h2>
        <p class="req">Windows 64-bit</p>
        <p class="note">If SmartScreen says &ldquo;unknown publisher&rdquo;, click <span class="kbd">More info</span>, then <span class="kbd">Run anyway</span>.</p>
        <a class="btn" href="{{BASE_URL}}/download/Backer-Windows-x64-setup.exe">Download for Windows</a>
      </div>
    </div>
    <p>Need help? <a href="/backer/report.html">Report an issue</a> or write to <a class="support-mail" href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>
  </main>'''

REPORT = '''
  <main id="main" class="bk-simple wrap">
    <h1>Report an issue</h1>
    <p class="lede">Tell us what went wrong with Backer. The more detail you give, the easier it is to fix.</p>
    <p class="notice" id="problem" role="alert" hidden>That did not go through. Check the form and try again, or write to <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>

    <form class="form" id="report-form" action="/api/report" method="POST" novalidate>
      <div class="field">
        <label for="summary">Summary</label>
        <input id="summary" name="summary" type="text" maxlength="120" required autocomplete="off" aria-describedby="summary-err">
        <p class="hint">One line, for example &ldquo;Backup stops at 40%&rdquo;.</p>
        <p class="err" id="summary-err" role="alert"></p>
      </div>
      <div class="field">
        <label for="details">What happened</label>
        <textarea id="details" name="details" maxlength="3000" required aria-describedby="details-err"></textarea>
        <p class="err" id="details-err" role="alert"></p>
      </div>
      <div class="field">
        <label for="steps">Steps to reproduce <span class="opt">(optional)</span></label>
        <textarea id="steps" name="steps" maxlength="2000" aria-describedby="steps-err"></textarea>
        <p class="err" id="steps-err" role="alert"></p>
      </div>
      <div class="row2">
        <div class="field">
          <label for="platform">Your computer</label>
          <select id="platform" name="platform" required aria-describedby="platform-err">
            <option value="macOS">macOS</option>
            <option value="Windows">Windows</option>
            <option value="Not sure">Not sure</option>
          </select>
          <p class="err" id="platform-err" role="alert"></p>
        </div>
        <div class="field">
          <label for="version">Backer version <span class="opt">(optional)</span></label>
          <input id="version" name="version" type="text" maxlength="40" autocomplete="off" placeholder="1.0.0" aria-describedby="version-err">
          <p class="err" id="version-err" role="alert"></p>
        </div>
      </div>
      <div class="field">
        <label for="nas">NAS make and model <span class="opt">(optional)</span></label>
        <input id="nas" name="nas" type="text" maxlength="100" autocomplete="off" placeholder="Synology DS920+" aria-describedby="nas-err">
        <p class="err" id="nas-err" role="alert"></p>
      </div>
      <div class="field">
        <label for="email">Your email <span class="opt">(optional)</span></label>
        <input id="email" name="email" type="email" maxlength="254" autocomplete="email" aria-describedby="email-hint email-err">
        <p class="hint" id="email-hint">Add it if you want a reply. We use it only to answer this report.</p>
        <p class="err" id="email-err" role="alert"></p>
      </div>
      <p class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></p>
      <p class="notice">Please do not include passwords or license keys. Reports go to our private issue tracker.</p>
      <div><button class="btn" type="submit" id="send">Send report</button></div>
      <p class="form-msg" id="status" role="status"></p>
    </form>

    <div class="done" id="done" hidden>
      <h2>Thanks, we have your report.</h2>
      <p>It went to our issue tracker. <span id="ref-wrap" hidden>Your reference is <span class="ref" id="ref"></span>.</span></p>
      <p><a href="/backer/">Back to Backer</a></p>
    </div>
  </main>
<script>
(function () {
  var form = document.getElementById('report-form');
  var status = document.getElementById('status');
  var send = document.getElementById('send');
  var fields = ['summary', 'details', 'steps', 'platform', 'version', 'nas', 'email'];
  try {
    var os = document.documentElement.getAttribute('data-os');
    if (os === 'win') document.getElementById('platform').value = 'Windows';
    else if (os === 'mac') document.getElementById('platform').value = 'macOS';
    else document.getElementById('platform').value = 'Not sure';
    if (/[?&]problem=1/.test(location.search)) document.getElementById('problem').hidden = false;
  } catch (e) {}

  function setErr(name, msg) {
    var el = document.getElementById(name), out = document.getElementById(name + '-err');
    if (out) out.textContent = msg || '';
    if (el) { if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
  }
  function clearAll() { fields.forEach(function (n) { setErr(n, ''); }); status.textContent = ''; status.className = 'form-msg'; }
  function fail(msg) { status.className = 'form-msg bad'; status.textContent = msg; }

  form.addEventListener('submit', function (e) {
    if (!window.fetch) return;            // without scripting, the form posts normally
    e.preventDefault();
    clearAll();
    var d = {}; fields.forEach(function (n) { d[n] = form.elements[n].value.trim(); });
    d.website = form.elements.website.value;
    var first = null;
    if (!d.summary) { setErr('summary', 'Add a short summary.'); first = first || 'summary'; }
    if (!d.details) { setErr('details', 'Describe what happened.'); first = first || 'details'; }
    if (d.email && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(d.email)) { setErr('email', 'That email address does not look right.'); first = first || 'email'; }
    if (first) { document.getElementById(first).focus(); return; }
    send.disabled = true; status.textContent = 'Sending…';
    fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(d) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (x) {
        send.disabled = false;
        if (x.s === 200 && x.j.ok) {
          form.hidden = true; document.getElementById('done').hidden = false;
          if (x.j.ref) { document.getElementById('ref').textContent = '#' + x.j.ref; document.getElementById('ref-wrap').hidden = false; }
          document.getElementById('done').querySelector('h2').focus && 0;
          window.scrollTo(0, 0);
        } else if (x.s === 400 && x.j.fields) {
          status.textContent = '';
          Object.keys(x.j.fields).forEach(function (k) { setErr(k, x.j.fields[k]); });
          var k0 = Object.keys(x.j.fields)[0]; if (document.getElementById(k0)) document.getElementById(k0).focus();
        } else if (x.s === 429) {
          fail('Too many reports from your network right now. Try again in an hour, or write to {{SUPPORT_EMAIL}}.');
        } else {
          fail('That did not go through. Try again, or write to {{SUPPORT_EMAIL}}.');
        }
      })
      .catch(function () { send.disabled = false; fail('That did not go through. Check your connection and try again, or write to {{SUPPORT_EMAIL}}.'); });
  });
})();
</script>'''

SENT = '''
  <main id="main" class="bk-simple wrap">
    <h1>Thanks, we have your report.</h1>
    <p class="lede">It went to our issue tracker.</p>
    <a class="btn" href="/backer/">Back to Backer</a>
  </main>'''

import html as _html, datetime

def load_releases():
    f = os.path.join(HERE, "releases.json")
    return json.load(open(f)) if os.path.exists(f) else []

def _inline(t):
    t = _html.escape(t)
    t = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', t)
    t = re.sub(r'(?<![">])(https://github\.com/[^\s/]+/[^\s/]+/pull/(\d+))', r'<a href="\1">#\2</a>', t)
    t = re.sub(r'(?<![">])(https://github\.com/[^\s<]+)', r'<a href="\1">\1</a>', t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    return re.sub(r"`([^`]+)`", r"<code>\1</code>", t)

def md(body):
    """Small converter for GitHub release notes: headings, bullets, paragraphs, links, bold, code."""
    out, in_ul = [], False
    for line in body.replace("\r", "").split("\n"):
        li = re.match(r"\s*[*-]\s+(.*)", line)
        if li:
            if not in_ul: out.append("<ul>"); in_ul = True
            out.append(f"<li>{_inline(li.group(1))}</li>"); continue
        if in_ul: out.append("</ul>"); in_ul = False
        h = re.match(r"#{1,6}\s+(.*)", line)
        if h: out.append(f"<h4>{_inline(h.group(1))}</h4>")
        elif line.strip(): out.append(f"<p>{_inline(line.strip())}</p>")
    if in_ul: out.append("</ul>")
    return "\n".join(out)

def _date(d):
    try: return datetime.date.fromisoformat(d).strftime("%B %-d, %Y")
    except ValueError: return d

def _size(n):
    return f"{n / 1048576:.1f} MB"

def asset_links(rel):
    """One link per installer, labelled by file type so renamed assets keep working."""
    kinds = {".dmg": "macOS (Apple silicon)", ".msi": "Windows", ".exe": "Windows"}
    links = []
    for a in rel["assets"]:
        ext = os.path.splitext(a["name"])[1].lower()
        if ext not in kinds: continue
        links.append(f'<a class="btn btn-small" href="{_html.escape(a["url"])}">{kinds[ext]}</a>'
                     f'<span class="file">{_html.escape(a["name"])} · {_size(a["size"])}</span>')
    return links

def releases_body(rels):
    if not rels:
        return '<main id="main" class="bk-simple wrap"><h1>Releases</h1><p class="lede">No releases are published yet.</p><a class="btn" href="/backer/">Back to Backer</a></main>'
    rows = []
    for i, r in enumerate(rels):
        links = "".join(f"<li>{l}</li>" for l in asset_links(r)) or "<li>No installers attached.</li>"
        tag = ' <span class="rec">Latest</span>' if i == 0 and not r["prerelease"] else (' <span class="rec">Pre-release</span>' if r["prerelease"] else "")
        rows.append(f'<article class="rel" id="{_html.escape(r["tag"])}"><h2>{_html.escape(r["name"])}{tag}</h2>'
                    f'<p class="req">{_date(r["date"])} · <a href="/backer/notes.html#{_html.escape(r["tag"])}">Release notes</a></p>'
                    f'<ul class="rel-dl">{links}</ul></article>')
    return ('<main id="main" class="bk-simple wrap"><h1>Releases</h1>'
            '<p class="lede">Every version of Backer, newest first. The <a href="/backer/">Backer page</a> always has the current download.</p>'
            + "".join(rows) + '<a class="btn" href="/backer/">Back to Backer</a></main>')

def notes_body(rels):
    if not rels:
        return '<main id="main" class="bk-simple wrap"><h1>Release notes</h1><p class="lede">No releases are published yet.</p><a class="btn" href="/backer/">Back to Backer</a></main>'
    rows = []
    for r in rels:
        body = re.sub(r"\*\*Full Changelog\*\*:.*", "", r["body"]).strip()
        rows.append(f'<article class="rel" id="{_html.escape(r["tag"])}"><h2>{_html.escape(r["name"])}</h2>'
                    f'<p class="req">{_date(r["date"])} · <a href="/backer/releases.html#{_html.escape(r["tag"])}">Download</a></p>'
                    f'<div class="prose">{md(body) or "<p>No notes for this release.</p>"}</div></article>')
    return ('<main id="main" class="bk-simple wrap"><h1>Release notes</h1>'
            '<p class="lede">What changed in each version of Backer, newest first.</p>'
            + "".join(rows) + '<a class="btn" href="/backer/">Back to Backer</a></main>')

PAGES = [  # file, title, description, body, extra script, noindex
    ("index.html", "Backer photo and video backup", "Backer backs up your photos and videos from a Mac or PC to a NAS on a schedule or on demand. It never deletes anything on the NAS without asking. No cloud, no subscription.", INDEX, VERSION_JS, False),
    ("thanks.html", "Thanks for buying Backer", "", THANKS, "", True),
    ("releases.html", "Backer releases and downloads", "Every Backer release with download links for macOS and Windows.", None, "", False),
    ("notes.html", "Backer release notes", "What changed in each version of Backer.", None, "", False),
    ("report.html", "Report an issue with Backer", "Tell us what went wrong with Backer.", REPORT, "", False),
    ("report-sent.html", "Report received", "", SENT, "", True),
]

def render(cfg, artifact):
    out = {}
    rels = load_releases()
    for fname, title, desc, body, extra, noindex in PAGES:
        if fname == "releases.html": body = releases_body(rels)
        if fname == "notes.html": body = notes_body(rels)
        path = "/backer/" + ("" if fname == "index.html" else fname)
        meta = f'<meta name="description" content="{desc}">\n' if desc else ""
        if noindex: meta += '<meta name="robots" content="noindex">\n'
        meta += f'<link rel="canonical" href="https://turtlebox.studio{path}">\n'
        head_common = (f'<title>{title}</title>\n{meta}'
                       '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n')
        if artifact:
            tb = re.sub(r"@font-face[^}]*}\n?", "", TB_CSS)
            style = f'<style>\n{tb}\n{CSS}\n</style>'
            fonts = GFONTS
        else:
            style = (f'<link rel="stylesheet" href="/assets/styles.css?v={TB_V}">\n'
                     f'<link rel="stylesheet" href="/assets/store.css?v={TB_V}">\n'
                     f'<link rel="stylesheet" href="/assets/backer.css?v={V}">')
            fonts = '<link rel="preload" href="/assets/fonts/Inter-Light.woff2" as="font" type="font/woff2" crossorigin>'
        page = f'''<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#F5F0E7">
{head_common}{fonts}
{DETECT}
{style}
</head>
<body>
{SPRITES}
<a class="skip" href="#main">Skip to content</a>
{HEADER}
{body}
{footer()}
{extra}
</body>
</html>
'''
        out[fname] = page
    return out

def fill(s, cfg):
    """Fill placeholders. Anything not configured yet is shown honestly as "Coming soon" instead of a dead link."""
    soon = '<span class="btn" aria-disabled="true">Coming soon</span>'
    if not cfg["base_url"].strip():
        # No update host yet: link the installers from the newest published GitHub release instead.
        latest = {}
        for rel in load_releases()[:1]:
            for a in rel.get("assets", []):
                ext = os.path.splitext(a["name"])[1].lower()
                if ext == ".dmg": latest.setdefault("mac", a["url"])
                if ext in (".exe", ".msi"): latest.setdefault("win", a["url"])
        def dl(m):
            url = latest.get("mac" if "macOS" in m.group(1) else "win")
            return m.group(0).replace(m.group(1), _html.escape(url)) if url else soon
        s = re.sub(r'<a class="btn" href="(\{\{BASE_URL\}\}/download/[^"]*)">.*?</a>', dl, s)
        s = re.sub(r'<p class="file">Backer-[^<]*</p>', "", s)
    paddle = bool(cfg.get("paddle_client_token", "").strip() and cfg.get("paddle_price_id", "").strip())
    checkout = (cfg.get("checkout_url") or cfg.get("fastspring_url") or "").strip()
    if paddle and not checkout:
        checkout = "#pricing"
    if not checkout:
        s = re.sub(r'<a class="btn[^"]*" href="\{\{CHECKOUT_URL\}\}"[^>]*>.*?</a>', soon, s)
    if paddle:
        s = s.replace("</body>", PADDLE_JS.replace("{{TOKEN}}", cfg["paddle_client_token"].strip())
                      .replace("{{PRICE_ID}}", cfg["paddle_price_id"].strip()) + "\n</body>", 1) if "data-paddle-buy" in s else s
    price = (cfg.get("price") or "").strip()
    s = s.replace("{{PRICE}}", price.replace("&", "&amp;").replace("<", "&lt;") if price else todo("Backer price, e.g. $29"))
    if not cfg["support_email"].strip():
        s = re.sub(r'<a class="support-mail" href="mailto:\{\{SUPPORT_EMAIL\}\}">.*?</a>', "the form above", s)
    return (s.replace("{{BASE_URL}}", cfg["base_url"].rstrip("/")).replace("{{CHECKOUT_URL}}", checkout)
             .replace("{{SUPPORT_EMAIL}}", cfg["support_email"]))

def strip_wrapper(page):
    """Artifact pages other than the main one stay full documents; the main page is wrapped by the publisher."""
    s = page.replace("<!doctype html>\n", "").replace('<html lang="en" data-theme="light">\n', "")
    s = s.replace("<head>\n", "").replace("</head>\n", "").replace("<body>\n", "").replace("</body>\n</html>\n", "")
    s = s.replace('<meta charset="utf-8">\n', "").replace('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n', "")
    s = s.replace('<meta name="color-scheme" content="light">\n', "")
    # title first, then the side-gutter promise
    m = re.search(r"<title>.*?</title>\n", s)
    s = s.replace(m.group(0), "")
    return m.group(0) + '<meta name="claude:viewport-fit-sides" content="cover">\n' + s

def main():
    cfg = json.load(open(os.path.join(HERE, "config.json")))
    if "--artifact" in sys.argv:
        d = sys.argv[sys.argv.index("--artifact") + 1]
        os.makedirs(d, exist_ok=True)
        pages = render(cfg, True)
        for f, p in pages.items():
            if f == "index.html":
                p = strip_wrapper(p)
                p = p.replace("<html", "<html")
            open(os.path.join(d, "artifact-" + f if f == "index.html" else f), "w").write(p)
        print("review copies written to", d); return
    pages = render(cfg, False)
    os.makedirs(os.path.join(OUT, "backer"), exist_ok=True)
    for f, p in pages.items():
        open(os.path.join(OUT, "backer", f), "w").write(add_tag(fill(p, cfg)))
    open(os.path.join(OUT, "assets", "backer.css"), "w").write(CSS)
    if os.path.exists(os.path.join(HERE, "releases.json")):  # published copy, so the release watcher can tell when the site is out of date
        shutil.copy(os.path.join(HERE, "releases.json"), os.path.join(OUT, "backer", "releases.json"))
    print("Backer pages built into turtlebox/backer/")

main()
