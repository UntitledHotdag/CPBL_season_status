#!/usr/bin/env python3
"""Build the deployable single-page site.

    src/app.html  (template, contains data placeholders and /*__GA_ID__*/)
  + src/games.json (360 games, compact JSON)
  + src/postseason.json (completed postseason games, compact JSON)
  + src/taiwan-series.json (Taiwan Series card data)
  -> docs/index.html  (what Cloudflare serves)

Usage:
    python3 tools/build.py            # production build (GA ID baked in)
    python3 tools/build.py --no-ga    # build without GA (local experiments)

Never edit docs/index.html by hand — edit src/app.html and rebuild.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GA_ID = "G-3NFXSVM2JD"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-ga", action="store_true", help="leave GA_ID empty")
    args = ap.parse_args()

    tpl = (ROOT / "src/app.html").read_text(encoding="utf-8")
    games = json.loads((ROOT / "src/games.json").read_text(encoding="utf-8"))
    postseason = json.loads((ROOT / "src/postseason.json").read_text(encoding="utf-8"))
    taiwan_series = json.loads((ROOT / "src/taiwan-series.json").read_text(encoding="utf-8"))
    assert len(games) == 360 and all(g["d"] for g in games), "games.json must hold 360 dated games"
    required = {"series", "g", "d", "a", "h", "as", "hs", "v", "wp", "lp", "sv", "mvp"}
    assert postseason and all(required <= game.keys() for game in postseason), "postseason.json has incomplete games"
    ts_schedule_required = {"year", "g", "date", "time", "startsAt", "away", "home", "dataReady"}
    ts_result_required = {"venue", "awayScore", "homeScore", "teams", "seriesRecord", "innings", "rhe"}
    assert taiwan_series and all(ts_schedule_required <= game.keys() for game in taiwan_series), "taiwan-series.json has incomplete schedule entries"
    assert all(game["g"] == index for index, game in enumerate(taiwan_series, 1)), "taiwan-series.json must contain G1-G7 in order"
    assert all(game["away"] != game["home"] for game in taiwan_series), "Taiwan Series opponents must be different"
    assert all(game.get("dataReady") is False or ts_result_required <= game.keys() for game in taiwan_series), "taiwan-series.json has incomplete result data"

    games_js = json.dumps(games, ensure_ascii=False, separators=(",", ":"))
    postseason_js = json.dumps(postseason, ensure_ascii=False, separators=(",", ":"))
    taiwan_series_js = json.dumps(taiwan_series, ensure_ascii=False, separators=(",", ":"))
    page = tpl.replace("/*__GAMES_JSON__*/", games_js)
    page = page.replace("/*__POSTSEASON_JSON__*/", postseason_js)
    page = page.replace("/*__TAIWAN_SERIES_JSON__*/", taiwan_series_js)
    page = page.replace('"/*__GA_ID__*/"', '""' if args.no_ga else f'"{GA_ID}"')
    assert "/*__" not in page, "unreplaced placeholder left in template"

    # src/app.html starts with <title>/<meta>/<style>; wrap it in a full document.
    cut = page.index("</style>") + len("</style>")
    html = ("<!doctype html>\n<html lang=\"zh-Hant\">\n<head>\n<meta charset=\"utf-8\">\n"
            + page[:cut] + "\n</head>\n<body>\n" + page[cut:] + "\n</body>\n</html>\n")
    out = ROOT / "docs/index.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)} ({len(html.encode()) // 1024} KB, GA {'off' if args.no_ga else GA_ID})")


if __name__ == "__main__":
    main()
