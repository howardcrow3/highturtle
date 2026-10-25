#!/usr/bin/env python3
"""Build the High Turtle site's shared pieces from the Turtlebox design system.

Writes (repo root): assets/styles.css, assets/fonts/*, assets/logo-*.svg, assets/wordmark.svg, assets/og.png,
favicon.svg, apple-touch-icon.png. Run build.py first, then this.
"""
import os, pathlib, shutil, subprocess, sys, tempfile
HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent
A = ROOT / "assets"

css = "\n".join((HERE / p).read_text() for p in ("tokens.css", "components/bundle.css", "sites/highturtle.css"))
(A / "styles.css").write_text(css)

(A / "fonts").mkdir(exist_ok=True)
for old in list((A / "fonts").iterdir()): old.unlink()
for f in (HERE / "fonts").iterdir(): shutil.copy(f, A / "fonts" / f.name)

with tempfile.TemporaryDirectory() as tmp:
    env = dict(os.environ, BRAND_NAME="High Turtle", BRAND_DOMAIN="highturtle.com", BRAND_OUT=tmp,
               BRAND_HEAD="Everything it takes to make a good AI product.")
    subprocess.run([sys.executable, "-I", str(HERE / "build_assets.py")], check=True, env=env)
    T = pathlib.Path(tmp) / "assets"
    for n in ("logo-horizontal", "logo-stacked", "wordmark"):
        shutil.copy(T / "Logo" / f"{n}.svg", A / f"{n}.svg")
    shutil.copy(T / "Social" / "og.png", A / "og.png")
    shutil.copy(T / "Icons" / "favicon.svg", ROOT / "favicon.svg")
    shutil.copy(T / "Icons" / "apple-touch-icon.png", ROOT / "apple-touch-icon.png")
print("high turtle assets built")
