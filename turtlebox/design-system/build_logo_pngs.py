#!/usr/bin/env python3
"""Render PNG exports of every logo SVG (assets/Logo and colorways) at 2x. Run after build_assets.py and build_colorways.py.
Writes assets/Logo/png/<name>.png and assets/Logo/colorways/png/<name>.png. Transparent ground for plain logos."""
import asyncio, pathlib, re
from playwright.async_api import async_playwright
H = pathlib.Path(__file__).parent
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); n = 0
        for d in (H / "assets/Logo", H / "assets/Logo/colorways"):
            out = d / "png"; out.mkdir(exist_ok=True)
            for old in out.glob("*.png"): old.unlink()
            for f in sorted(d.glob("*.svg")):
                s = f.read_text(); w, h = [float(x) for x in re.search(r'viewBox="[\d.\s]*?([\d.]+) ([\d.]+)"', s).groups()]
                k = 1600 / max(w, h) if "colorways" not in str(d) else 1024 / max(w, h)
                pg = await b.new_page(viewport={"width": round(w * k), "height": round(h * k)})
                await pg.goto(f"file://{f}")
                await pg.evaluate(f"(()=>{{const e=document.documentElement;e.setAttribute('width','{round(w*k)}');e.setAttribute('height','{round(h*k)}')}})()")
                await pg.screenshot(path=str(out / (f.stem + ".png")), omit_background=True); await pg.close(); n += 1
        await b.close(); print(n, "logo PNGs")
asyncio.run(main())
