#!/usr/bin/env python3
"""Pre-render the two Taiwan Series hero cards (1.賽事預言 before → after the game) with the
site's own Canvas renderers, so #taiwan-series only loads two small JPGs.

Reads : tools/ts_hero_sample.json — sample game (box score), sample prediction,
          and which owner photo / crop each card uses
        assets/wall-photos/*.jpg — the site owner's own stadium photos
Writes: docs/img/taiwan-series/hero-prediction.jpg  600×1067  1.賽事預言（賽前）
        docs/img/taiwan-series/hero-answer.jpg      600×1067  1.賽事預言（賽後結算）
        <promo-dir>/ts-*.png                        1080×1920 full-size PNGs
          (prediction, answer, 3.賽事回顧, 3.最愛球員) for social posts

Usage:  python3 tools/build.py && python3 tools/prerender_ts_hero.py [--promo-dir "Claude outputs/promo"]
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
  await document.fonts.load('800 200px Manrope', '0123456789.:');
  const photo = async p => {
    const blob = await (await fetch('/assets/wall-photos/' + p.photo + '.jpg')).blob();
    const bm = await createImageBitmap(blob);
    return {blob, w:bm.width, h:bm.height, fx:p.fx, fy:p.fy, z:p.z};
  };
  const usePhoto = p => { tsPhoto = p; tsPhotoURL = URL.createObjectURL(p.blob); };
  document.getElementById('ts-fan-name').value = c.fanName || '';
  const enc = (cv, t, q) => new Promise(r => cv.toBlob(b => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }, t, q));
  const shrink = big => { const s = document.createElement('canvas'); s.width = 600; s.height = 1067;
    const x = s.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(big, 0, 0, 600, 1067); return s; };
  const out = {};
  const before = {...c.game, dataReady:false};          // the card as it looks before first pitch
  usePhoto(await photo(c.before));
  let cv = await tsDrawPrediction(before, {...c.prediction}, c.before.stamp);
  out.prediction = {png: await enc(cv, 'image/png'), jpg: await enc(shrink(cv), 'image/jpeg', .84)};
  cv = await tsDrawPrediction(c.game, {...c.prediction}, c.after.stamp);   // same card, settled after the game
  out.answer = {png: await enc(cv, 'image/png'), jpg: await enc(shrink(cv), 'image/jpeg', .84)};
  usePhoto(await photo(c.after));
  cv = await tsDrawCover(c.game, c.after.team, c.after.stamp);
  out.recap = {png: await enc(cv, 'image/png')};
  const players = tsPlayers(c.game), mvp = players.find(p => p.data.name === c.game.mvp.name) || players[0];
  cv = await tsDrawPlayer(c.game, mvp, c.after.stamp);
  out.player = {png: await enc(cv, 'image/png')};
  return out;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--promo-dir", default=str(ROOT / "Claude outputs/promo"))
    args = ap.parse_args()
    sample = json.loads((ROOT / "tools/ts_hero_sample.json").read_text(encoding="utf-8"))
    out_dir = ROOT / "docs/img/taiwan-series"; out_dir.mkdir(parents=True, exist_ok=True)
    promo = Path(args.promo_dir); promo.mkdir(parents=True, exist_ok=True)

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/docs/index.html"   # localhost → GA and API stay off
    dec = lambda d: base64.b64decode(d.split(",", 1)[1])
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = new_page(b)
        pg.goto(base + "#taiwan-series"); pg.wait_for_timeout(800)
        r = pg.evaluate(JS, sample)
        (out_dir / "hero-prediction.jpg").write_bytes(dec(r["prediction"]["jpg"]))
        (out_dir / "hero-answer.jpg").write_bytes(dec(r["answer"]["jpg"]))
        for key in ("prediction", "answer", "recap", "player"):
            (promo / f"ts-{key}.png").write_bytes(dec(r[key]["png"]))
        b.close()
    srv.shutdown()
    print(f"wrote {out_dir.relative_to(ROOT)}/hero-prediction.jpg, hero-answer.jpg and 4 PNGs in {promo}")


def new_page(browser):
    """Separate so an offline runner can swap in a context that serves fonts locally."""
    return browser.new_page()


if __name__ == "__main__":
    main()
