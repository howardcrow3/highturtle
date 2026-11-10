#!/usr/bin/env python3
"""Builds the Backer pages that live at turtlebox.studio/backer/.

  python3 backer/build.py                 build into turtlebox/backer/ (values missing from backer/config.json show as 'Coming soon')
  python3 backer/build.py --artifact DIR  write review copies into DIR (placeholders left visible, Google Fonts, inline CSS)

Config values:
  base_url        update hosting address, ending in /backer, for example https://dxxxx.cloudfront.net/backer
  fastspring_url  FastSpring checkout URL for "Buy now"
  support_email   support address shown on the pages
  company         company name for the footer
Pages are light only. Nothing is written to turtlebox/ until all four values are filled in.
"""
import json, os, re, shutil, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "turtlebox")
V = "bk1"

mark_svg = open(os.path.join(ROOT, "assets", "mark.svg")).read()
MARK_PATH = re.search(r"<path[^>]*/>", mark_svg).group(0)
MARK_VB = re.search(r'viewBox="([^"]+)"', mark_svg).group(1)
icon_svg = open(os.path.join(HERE, "icon-placeholder.svg")).read()
ICON_INNER = re.sub(r"^<svg[^>]*>|</svg>$", "", icon_svg.strip())
CSS = open(os.path.join(HERE, "backer.css")).read()

FONTFACE = '''@font-face { font-family: "Instrument Sans"; src: url("/assets/fonts/InstrumentSans-Variable.woff2") format("woff2"); font-weight: 400 700; font-style: normal; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url("/assets/fonts/JetBrainsMono-Variable.woff2") format("woff2"); font-weight: 100 800; font-style: normal; font-display: swap; }
'''
GFONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
          '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">')

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

HEADER = '''<header class="top">
    <a class="brand" href="/" aria-label="Turtlebox home"><svg viewBox="%s" aria-hidden="true"><use href="#mark"/></svg>Turtlebox</a>
    <nav aria-label="Main"><a href="/apps/">Apps</a><a href="/backer/">Backer</a></nav>
  </header>''' % MARK_VB

def footer(extra=""):
    return f'''<footer>
    <p><strong>Privacy.</strong> Backer sends nothing anywhere except update checks to our server and the purchase page. There is no telemetry. This website sets no cookies and has no tracking scripts.</p>
    <p class="foot-links"><a href="/backer/report.html">Report an issue</a><a href="/">Turtlebox</a><a href="/apps/">Apps</a></p>
    <p>&copy; {{{{COMPANY}}}}</p>{extra}
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

INDEX = '''
  <main id="main">
    <div class="hero" id="download">
      <p class="hero-app"><svg aria-hidden="true"><use href="#icon"/></svg>Backer, a Turtlebox app</p>
      <h1>Back up your photos and videos.</h1>
      <p class="lede">Backer copies your photo and video folders from a Mac or PC to a Synology or other NAS you own, on a schedule or on demand. <strong>It never deletes anything on the NAS without asking.</strong> No cloud, no subscription.</p>

      <div class="downloads">
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
        <span>Free for 14 days with every feature. <a href="#pricing">Pricing</a></span>
      </div>
    </div>

    <section id="features" aria-labelledby="features-h">
      <h2 id="features-h">What Backer does</h2>
      <ul class="features">
        <li><h3>Scheduled or on demand</h3><p>Set a schedule and forget it, or back up new photos and videos yourself when you want to.</p></li>
        <li><h3>Big libraries</h3><p>Handles <span class="mono">100,000+</span> files, so years of photos and video footage are fine.</p></li>
        <li><h3>Verify</h3><p>Compares what is on the NAS with your originals, so you know every photo and video was copied intact.</p></li>
        <li><h3>Asks before deleting</h3><p>Backer never removes a photo or video from the NAS without asking you first.</p></li>
        <li><h3>Optional AI assistant integration</h3><p>A local MCP server lets an AI assistant work with Backer. It is off by default.</p></li>
        <li><h3>Stays out of the way</h3><p>Lives in the menu bar on a Mac and in the system tray on Windows.</p></li>
      </ul>
    </section>

    <section id="pricing" aria-labelledby="pricing-h">
      <h2 id="pricing-h">Pricing</h2>
      <div class="price">
        <div>
          <h3>One-time purchase</h3>
          <ul>
            <li><strong>One key covers all 1.x versions.</strong> No subscription.</li>
            <li><strong>14-day free trial</strong> with every feature.</li>
            <li>After the trial, backups stop. Your history, Verify and restore keep working.</li>
          </ul>
        </div>
        <a class="btn" href="{{FASTSPRING_URL}}">Buy now</a>
      </div>
    </section>

    <section id="install" aria-labelledby="install-h">
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
    </section>

    <section id="help" aria-labelledby="help-h">
      <h2 id="help-h">After you buy</h2>
      <p>Your license key appears on the confirmation page and arrives by email.</p>
      <ol class="steps">
        <li>In Backer, open <span class="kbd">Settings</span>, then <span class="kbd">License</span>.</li>
        <li>Paste the key.</li>
        <li>Click <span class="kbd">Activate</span>.</li>
      </ol>
      <p>Keys are tied to the email address you bought with. If something does not work, <a href="/backer/report.html">report an issue</a> or write to <a class="support-mail" href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>
    </section>
  </main>'''

THANKS = '''
  <main id="main" class="simple">
    <h1>Thanks for buying Backer.</h1>
    <p class="lede">Your license key is on your order confirmation page and in the email we sent you. Here is how to turn it on.</p>
    <ol class="steps">
      <li>Open Backer, then go to <span class="kbd">Settings</span> and <span class="kbd">License</span>.</li>
      <li>Paste the key.</li>
      <li>Click <span class="kbd">Activate</span>.</li>
    </ol>
    <p class="lede">Keys are tied to the email address you bought with, and one key covers all 1.x versions.</p>
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
  <main id="main" class="simple">
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
          <input id="version" name="version" type="text" class="mono-in" maxlength="40" autocomplete="off" placeholder="1.0.0" aria-describedby="version-err">
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
      <p class="status" id="status" role="status"></p>
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
  function clearAll() { fields.forEach(function (n) { setErr(n, ''); }); status.textContent = ''; status.className = 'status'; }
  function fail(msg) { status.className = 'status bad'; status.textContent = msg; }

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
  <main id="main" class="simple">
    <h1>Thanks, we have your report.</h1>
    <p class="lede">It went to our issue tracker.</p>
    <a class="btn" href="/backer/">Back to Backer</a>
  </main>'''

PAGES = [  # file, title, description, body, extra script, noindex
    ("index.html", "Backer photo and video backup", "Backer backs up your photos and videos from a Mac or PC to a NAS on a schedule or on demand. It never deletes anything on the NAS without asking. No cloud, no subscription.", INDEX, VERSION_JS, False),
    ("thanks.html", "Thanks for buying Backer", "", THANKS, "", True),
    ("report.html", "Report an issue with Backer", "Tell us what went wrong with Backer.", REPORT, "", False),
    ("report-sent.html", "Report received", "", SENT, "", True),
]

def render(cfg, artifact):
    out = {}
    for fname, title, desc, body, extra, noindex in PAGES:
        path = "/backer/" + ("" if fname == "index.html" else fname)
        meta = f'<meta name="description" content="{desc}">\n' if desc else ""
        if noindex: meta += '<meta name="robots" content="noindex">\n'
        meta += f'<link rel="canonical" href="https://turtlebox.studio{path}">\n'
        head_common = (f'<title>{title}</title>\n{meta}'
                       '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n')
        if artifact:
            style = f'<style>\n{CSS}\n</style>'
            fonts = GFONTS
        else:
            style = f'<link rel="stylesheet" href="/assets/backer.css?v={V}">'
            fonts = ('<link rel="preload" href="/assets/fonts/InstrumentSans-Variable.woff2" as="font" type="font/woff2" crossorigin>\n'
                     '<link rel="preload" href="/assets/fonts/JetBrainsMono-Variable.woff2" as="font" type="font/woff2" crossorigin>')
        inner = (f'{DETECT}\n' if True else "") + f'<div class="bk-page">'
        page = f'''<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#F5F3EC">
{head_common}{fonts}
{DETECT}
{style}
</head>
<body>
{SPRITES}
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
  {HEADER}
{body}
  {footer()}
</div>
{extra}
</body>
</html>
'''
        out[fname] = page
    return out

def fill(s, cfg):
    """Fill placeholders. Anything not configured yet is shown honestly as "Coming soon" instead of a dead link."""
    soon = '<span class="btn" aria-disabled="true" style="opacity:.6;cursor:default">Coming soon</span>'
    if not cfg["base_url"].strip():
        s = re.sub(r'<a class="btn" href="\{\{BASE_URL\}\}/download/[^"]*">.*?</a>', soon, s)
    if not cfg["fastspring_url"].strip():
        s = re.sub(r'<a class="btn" href="\{\{FASTSPRING_URL\}\}">.*?</a>', soon, s)
    if not cfg["company"].strip():
        cfg = dict(cfg, company="Turtlebox")
    if not cfg["support_email"].strip():
        s = re.sub(r'<a class="support-mail" href="mailto:\{\{SUPPORT_EMAIL\}\}">.*?</a>', "the form above", s)
    return (s.replace("{{BASE_URL}}", cfg["base_url"].rstrip("/")).replace("{{FASTSPRING_URL}}", cfg["fastspring_url"])
             .replace("{{SUPPORT_EMAIL}}", cfg["support_email"]).replace("{{COMPANY}}", cfg["company"]))

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
        open(os.path.join(OUT, "backer", f), "w").write(fill(p, cfg))
    open(os.path.join(OUT, "assets", "backer.css"), "w").write(FONTFACE + CSS)
    fonts = os.path.join(OUT, "assets", "fonts"); os.makedirs(fonts, exist_ok=True)
    for f in os.listdir(os.path.join(HERE, "fonts")):
        shutil.copy(os.path.join(HERE, "fonts", f), fonts)
    print("Backer pages built into turtlebox/backer/")

main()
