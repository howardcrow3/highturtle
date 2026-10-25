#!/usr/bin/env python3
"""Generates the Turtlebox pages from apps.json. Run from the repo root: python3 turtlebox/build.py
Add an app by adding an entry to apps.json. Set "download": true on an app whose file is uploaded to the downloads bucket
(see infra/upload-app.sh) to show the email form on its card. Set "status" to "Live" and add "url" (for example /apps/my-app/)
to show an Open button."""
import html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
mark = open(os.path.join(HERE, "..", "assets", "mark.svg")).read()
mark_path = re.search(r'<path[^>]*/>', mark).group(0)
mark_vb = re.search(r'viewBox="([^"]+)"', mark).group(1)
V = "tb4"

def page(title, desc, body, path, robots=True, nav_current=""):
    def cur(p): return ' aria-current="page"' if nav_current == p else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#F5F0E7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1C1C1C" media="(prefers-color-scheme: dark)">
  {'' if robots else '<meta name="robots" content="noindex">'}
  <title>{html.escape(title)}</title>
  <meta name="description" content="{html.escape(desc)}">
  <link rel="canonical" href="https://turtlebox.studio{path}">
  <meta property="og:title" content="{html.escape(title)}">
  <meta property="og:description" content="{html.escape(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://turtlebox.studio{path}">
  <meta property="og:image" content="https://turtlebox.studio/assets/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preload" href="/assets/fonts/CormorantGaramond-Light.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/Inter-Light.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/styles.css?v={V}">
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
      <a href="/apps/"{cur("apps")}>Apps</a>
      <a href="https://highturtle.com">High Turtle</a>
    </nav>
  </div>
</header>
<main id="main">
{body}
</main>
<footer class="site-footer">
  <div class="wrap foot">
    <p>Turtlebox builds small AI apps.</p>
    <p>Also from us: <a href="https://highturtle.com">High Turtle</a> &middot; &copy; 2026 Turtlebox</p>
  </div>
</footer>
  <script src="/assets/site.js?v={V}" defer></script>
</body>
</html>
"""

def dl_form(a):
    slug = html.escape(a["slug"])
    return f"""<form class="dl-form" action="/api/download" method="POST">
          <input type="hidden" name="app" value="{slug}">
          <label for="e-{slug}">Email address</label>
          <input id="e-{slug}" name="email" type="email" autocomplete="email" required placeholder="you@company.com">
          <p class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="_gotcha" tabindex="-1" autocomplete="off"></label></p>
          <button class="btn btn-small" type="submit">Email me the download</button>
          <p class="fine">We email you a download link. You also join the High Turtle list for release news and can unsubscribe any time. <a href="https://highturtle.com/privacy.html">Privacy</a></p>
          <p class="form-status" role="status"></p>
        </form>"""

def card(a):
    live = a.get("status", "").lower() == "live" and a.get("url")
    cls = "status status-live" if live else ("status status-testing" if a.get("status", "").lower() == "in testing" else "status")
    action = f'<div class="action"><a class="btn btn-small" href="{html.escape(a["url"])}">Open {html.escape(a["name"])}</a></div>' if live else ""
    form = dl_form(a) if a.get("download") else ""
    return f"""      <li class="app-card">
        <h3>{html.escape(a["name"])}</h3>
        <p class="{cls}">{html.escape(a["status"])}</p>
        <p>{html.escape(a["description"])}</p>
        {action}
        {form}
      </li>"""

apps = json.load(open(os.path.join(HERE, "apps.json")))
cards = "\n".join(card(a) for a in apps)
grid = f'<ul class="apps">\n{cards}\n    </ul>' if apps else '<p class="empty">The first apps are in the works.</p>'

home = f"""  <section class="hero">
    <div class="wrap">
      <h1>Small AI apps that each do one job.</h1>
      <p class="lede">Turtlebox builds AI apps that run in your browser. Each one is built for a single task, so you can open it, use it and get on with your day.</p>
      <div class="cta-row">
        <a class="btn" href="/apps/">See the apps</a>
        <a class="link" href="https://highturtle.com">Visit High Turtle</a>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="wrap">
      <h2>How the apps work</h2>
      <ul class="points">
        <li><h3>One job each</h3><p>An app does one thing and says what that is before you start.</p></li>
        <li><h3>In your browser</h3><p>Open the page and use it. There is nothing to install.</p></li>
        <li><h3>Honest status</h3><p>Every app is marked Planned, In testing or Live, so you know what you are opening.</p></li>
      </ul>
    </div>
  </section>
  <section class="section">
    <div class="wrap">
      <h2>On the way</h2>
      <p class="intro">These are the first apps we are working on. None are open yet.</p>
      {grid}
    </div>
  </section>"""

apps_page = f"""  <div class="wrap page-head">
    <h1>Apps</h1>
    <p>Small AI apps from Turtlebox. Each one does one job and runs in your browser.</p>
  </div>
  <section class="section" style="border-top:0">
    <div class="wrap">
      {grid}
    </div>
  </section>"""

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

w("index.html", page("Turtlebox | Small AI apps that each do one job", "Turtlebox builds small AI apps that run in your browser. Each one does one job.", home, "/"))
w("apps/index.html", page("Apps | Turtlebox", "Small AI apps from Turtlebox. Each one does one job and runs in your browser.", apps_page, "/apps/", nav_current="apps"))
w("download-sent.html", page("Check your inbox | Turtlebox", "Download link sent.", sent, "/download-sent.html", robots=False))
w("download-problem.html", page("Download problem | Turtlebox", "Download problem.", prob, "/download-problem.html", robots=False))
w("404.html", page("Page not found | Turtlebox", "Page not found.", nf, "/404.html", robots=False))
w("robots.txt", "User-agent: *\nAllow: /\n\nSitemap: https://turtlebox.studio/sitemap.xml\n")
w("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://turtlebox.studio/</loc></url>\n  <url><loc>https://turtlebox.studio/apps/</loc></url>\n</urlset>\n')
fav = open(os.path.join(HERE, "..", "favicon.svg")).read()
w("favicon.svg", fav)
print("built")
