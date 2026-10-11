#!/usr/bin/env python3
"""Pre-render the landing-page recap wall (and the promo PNGs) with the site's own
Canvas renderer, so visitors only download small JPGs instead of computing them.

Reads : tools/wall_cards.json   — one entry per card:
          name   output file stem (docs/img/wall/<name>.jpg)
          team   team full name, or null for the neutral "觀賽摘要" layout
          games  list of game numbers forming the sample season
          photo  stem in assets/wall-photos/ (or null = team-colour background)
          fx/fy  focal point 0–1, z zoom ≥1 (same model as the in-app photo editor)
        assets/wall-photos/*.jpg — the site owner's own stadium photos
Writes: docs/img/wall/<name>.jpg   432×768 JPG for the landing wall
        docs/img/recap-brothers.jpg 600×1067, used in the "放上照片" section
        <promo-dir>/<name>.png      1080×1920 PNG for social posts (photo cards only)

Usage:  python3 tools/build.py && python3 tools/prerender_wall.py [--promo-dir "Claude outputs/promo"]
Needs:  pip install playwright && playwright install chromium
        Run on a machine that can reach Google Fonts (Manrope / Noto Sans TC),
        otherwise the images fall back to system fonts.
"""
import argparse, base64, json, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

JS = """async (c) => {
  await document.fonts.ready;
  await document.fonts.load('800 200px Manrope', '0123456789.');
  await document.fonts.load('700 40px "Noto Sans TC"', '我進場的時候贏了幾場');
  let ph = null;
  if (c.photo){
    const blob = await (await fetch('/assets/wall-photos/' + c.photo + '.jpg')).blob();
    const bm = await createImageBitmap(blob);
    ph = {blob, w:bm.width, h:bm.height, fx:c.fx, fy:c.fy, z:c.z};
  }
  const list = c.games.map(n => BY_N.get(n)).sort((x, y) => x.d === y.d ? x.n - y.n : x.d.localeCompare(y.d));
  const m = shareModel(list, c.team || null, "");
  const big = await drawShare(m, ph);
  const url = (cv, t, q) => new Promise(r => cv.toBlob(b => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }, t, q));
  const shrink = (w, h) => { const s = document.createElement('canvas'); s.width = w; s.height = h;
    const x = s.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(big, 0, 0, w, h); return s; };
  return {png: await url(big, 'image/png'), wall: await url(shrink(432, 768), 'image/jpeg', .82),
          feat: await url(shrink(600, 1067), 'image/jpeg', .82), big: m.big, rec: m.rec || '', luck: m.luck || ''};
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--promo-dir", default=str(ROOT / "Claude outputs/promo"))
    args = ap.parse_args()
    cards = json.loads((ROOT / "tools/wall_cards.json").read_text(encoding="utf-8"))
    wall = ROOT / "docs/img/wall"; wall.mkdir(parents=True, exist_ok=True)
    promo = Path(args.promo_dir); promo.mkdir(parents=True, exist_ok=True)

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/docs/index.html"   # localhost → GA stays off
    dec = lambda d: base64.b64decode(d.split(",", 1)[1])
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto(base + "#pick"); pg.wait_for_timeout(500)
        for c in cards:
            r = pg.evaluate(JS, c)
            (wall / f"{c['name']}.jpg").write_bytes(dec(r["wall"]))
            if c.get("photo"):
                (promo / f"recap-{c['name']}.png").write_bytes(dec(r["png"]))
            if c["name"] == "brothers":
                (ROOT / "docs/img/recap-brothers.jpg").write_bytes(dec(r["feat"]))
            print(f"{c['name']:<16} {r['big']:>5}  {r['rec']:<10} {r['luck']}")
        b.close()
    srv.shutdown()


if __name__ == "__main__":
    main()
