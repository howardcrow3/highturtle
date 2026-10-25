#!/usr/bin/env python3
"""Logo colorways from the palette in tokens.json. Keeps only ground/ink pairs that hold 4.5:1.
Writes assets/Logo/colorways/{mark,horizontal}-<ground>-on-<ink>.svg. Run after build_assets.py."""
import json, re, pathlib, itertools
H = pathlib.Path(__file__).parent
pal = {t["name"]: t["value"] for t in json.load(open(H / "tokens.json"))["color"]["tokens"] if t["usage"].startswith("Palette.")}
def lum(h):
    h = h.lstrip("#"); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]; return .2126*c[0] + .7152*c[1] + .0722*c[2]
def cr(a, b): hi, lo = sorted((lum(a), lum(b)), reverse=True); return (hi + .05) / (lo + .05)
grounds = ["ivory", "warm-white", "stone", "gold", "ash", "charcoal"]
inks = ["charcoal", "ivory", "stone", "gold"]
mark_d = re.search(r' d="([^"]+)"', (H / "assets/Logo/mark.svg").read_text()).group(1)
hz = (H / "assets/Logo/logo-horizontal.svg").read_text()
vb = [float(x) for x in re.search(r'viewBox="([^"]+)"', hz).group(1).split()]
inner = re.search(r">(.*)</svg>", hz, re.S).group(1)
inner = re.sub(r'<rect[^>]*/>', '', inner)
out = H / "assets/Logo/colorways"; out.mkdir(exist_ok=True)
for f in out.glob("*.svg"): f.unlink()
made = []
for g, i in itertools.product(grounds, inks):
    if g == i or cr(pal[g], pal[i]) < 4.5: continue
    G, I = pal[g], pal[i]; k = f"{g}-on-{i}".replace("-on-", "_ink-") if False else f"{i}-on-{g}"
    mw = 512 * .62; mh = mw * 225 / 426
    (out / f"mark-{k}.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="{G}"/><g transform="translate({(512-mw)/2:.1f} {(512-mh)/2:.1f}) scale({mw/426:.5f})"><path fill="{I}" fill-rule="evenodd" d="{mark_d}"/></g></svg>\n')
    pad = 48; w, h = vb[2] + 2 * pad, vb[3] + 2 * pad
    body = re.sub(r'fill="#[0-9a-fA-F]{6}"', f'fill="{I}"', inner)
    (out / f"horizontal-{k}.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}"><rect width="{w:g}" height="{h:g}" fill="{G}"/><g transform="translate({pad} {pad})">{body}</g></svg>\n')
    made.append((k, cr(G, I)))
for k, c in made: print(f"{k:24s} {c:.1f}:1")
