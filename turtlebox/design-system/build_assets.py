#!/usr/bin/env python3
"""Generate logo SVGs, icons and the social image from the turtle mark + fonts. Run after build.py."""
import re, pathlib, asyncio, base64
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
HERE = pathlib.Path(__file__).parent
INK, IVORY, CHAR = "#1c1c1c", "#f5f0e7", "#1c1c1c"
mark_src = (HERE.parent.parent / "assets" / "mark.svg").read_text()
mark_d = re.search(r' d="([^"]+)"', mark_src).group(1)
MW, MH = 426, 225

font = TTFont(HERE / "fonts" / "CormorantGaramond-SemiBold.woff2")
gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
def word_path(text, size, x0=0, baseline=0):
    s = size / upm; x = x0; d = []
    for ch in text:
        g = cmap[ord(ch)]; pen = SVGPathPen(gs)
        gs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, baseline))); d.append(pen.getCommands())
        x += gs[g].width * s
    return " ".join(d), x
asc = font["hhea"].ascent / upm

def svg(w, h, body, bg=None):
    r = f'<rect width="{w}" height="{h}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}">{r}{body}</svg>\n'
def write(p, s): (HERE / p).write_text(s)

for suffix, fill in (("", INK), ("-reversed", IVORY)):
    # mark alone
    write(f"assets/Logo/mark{suffix}.svg", svg(MW, MH, f'<path fill="{fill}" fill-rule="evenodd" d="{mark_d}"/>'))
    # wordmark alone (26px type, scaled up 4x for a usable viewBox)
    size = 104; wd, ww = word_path("Turtlebox", size, 0, size * 0.78)
    write(f"assets/Logo/wordmark{suffix}.svg", svg(round(ww, 1), size, f'<path fill="{fill}" d="{wd}"/>'))
    # horizontal lockup: mark 32px high, 12px gap, 26px type -> scale x(100/32)
    k = 100 / 32; mh = 32 * k; mw = MW * mh / MH; gap = 12 * k; tsize = 26 * k
    wd, ww = word_path("Turtlebox", tsize, mw + gap, mh / 2 + tsize * 0.3)
    w = ww; 
    body = (f'<g transform="scale({mh/MH:.5f})"><path fill="{fill}" fill-rule="evenodd" d="{mark_d}"/></g>'
            f'<path fill="{fill}" d="{wd}"/>')
    write(f"assets/Logo/logo-horizontal{suffix}.svg", svg(round(w, 1), round(mh, 1), body))
    # stacked lockup
    tsize = 120; _, tw = word_path("Turtlebox", tsize, 0, 0)
    W = tw; mkw = W * 0.5; mkh = mkw * MH / MW; gapv = tsize * 0.45
    wd, _ = word_path("Turtlebox", tsize, 0, mkh + gapv + tsize * 0.7)
    body = (f'<g transform="translate({(W-mkw)/2:.1f} 0) scale({mkw/MW:.5f})"><path fill="{fill}" fill-rule="evenodd" d="{mark_d}"/></g>'
            f'<path fill="{fill}" d="{wd}"/>')
    write(f"assets/Logo/logo-stacked{suffix}.svg", svg(round(W, 1), round(mkh + gapv + tsize * 0.95, 1), body))

# Icons. Mark centred on a square, inside 62% width.
def icon_svg(size, bg, fill, rx=0, inset=0.62):
    mw = size * inset; mh = mw * MH / MW; x = (size - mw) / 2; y = (size - mh) / 2
    r = f'<rect width="{size}" height="{size}" rx="{rx}" fill="{bg}"/>'
    return svg(size, size, f'{r}<g transform="translate({x:.1f} {y:.1f}) scale({mw/MW:.5f})"><path fill="{fill}" fill-rule="evenodd" d="{mark_d}"/></g>')
write("assets/Icons/app-icon-light.svg", icon_svg(1024, IVORY, INK))
write("assets/Icons/app-icon-dark.svg", icon_svg(1024, CHAR, IVORY))
write("assets/Icons/app-icon-rounded.svg", icon_svg(1024, IVORY, INK, rx=225))
# Adaptive favicon: transparent ground, ink follows the colour scheme
fav = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {MW} {MW}"><style>path{{fill:{INK}}}@media (prefers-color-scheme:dark){{path{{fill:{IVORY}}}}}</style>'
       f'<g transform="translate(0 {(MW-MH)/2})"><path fill-rule="evenodd" d="{mark_d}"/></g></svg>\n')
write("assets/Icons/favicon.svg", fav)

# Social image + PNG icons rendered with the real fonts
fontcss = "".join(f'@font-face{{font-family:"Cormorant Garamond";src:url(data:font/woff2;base64,{base64.b64encode((HERE/"fonts"/f).read_bytes()).decode()});font-weight:{wt}}}' for f, wt in (("CormorantGaramond-Light.woff2", 300), ("CormorantGaramond-SemiBold.woff2", 600))) + \
    f'@font-face{{font-family:Inter;src:url(data:font/woff2;base64,{base64.b64encode((HERE/"fonts"/"Inter-Medium.woff2").read_bytes()).decode()});font-weight:500}}'
social = f"""<style>{fontcss}*{{margin:0;box-sizing:border-box}}body{{width:1200px;height:630px;background:{IVORY};color:{INK};position:relative;overflow:hidden}}
.b{{position:absolute;inset:48px;border:1px solid #d9d2c5}}.m{{position:absolute;left:96px;top:92px;height:64px}}
.n{{position:absolute;left:240px;top:96px;font:600 52px/1 "Cormorant Garamond"}}
h1{{position:absolute;left:96px;top:236px;width:900px;font:300 104px/0.98 "Cormorant Garamond";letter-spacing:-0.03em}}
.u{{position:absolute;left:96px;bottom:92px;font:500 15px/1 Inter;letter-spacing:.3em;text-transform:uppercase}}
.u i{{display:inline-block;width:10px;height:10px;border-radius:50%;background:#d4a853;margin-right:14px}}</style>
<div class=b></div><svg class=m viewBox="0 0 {MW} {MH}"><path fill="{INK}" fill-rule="evenodd" d="{mark_d}"/></svg><div class=n>Turtlebox</div>
<h1>Small AI apps that each do one job.</h1><div class=u><i></i>turtlebox.studio</div>"""
(HERE / "_social.html").write_text(social)
from playwright.async_api import async_playwright
async def shoot():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1200, "height": 630}); await pg.goto(f"file://{HERE}/_social.html"); await pg.evaluate("document.fonts.ready")
        await pg.screenshot(path=str(HERE / "assets/Social/og.png"))
        for name, f in (("app-icon-1024", "app-icon-light.svg"), ("apple-touch-icon", "app-icon-light.svg")):
            sz = 180 if "apple" in name else 1024
            pg = await b.new_page(viewport={"width": sz, "height": sz}); await pg.goto(f"file://{HERE}/assets/Icons/{f}"); await pg.set_viewport_size({"width": sz, "height": sz}); await pg.evaluate(f"document.documentElement.setAttribute('width','{sz}');document.documentElement.setAttribute('height','{sz}')"); await pg.screenshot(path=str(HERE / f"assets/Icons/{name}.png"))
        await b.close()
asyncio.run(shoot()); (HERE / "_social.html").unlink()
print("assets built")
