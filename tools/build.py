#!/usr/bin/env python3
"""Build the deployable single-page site.

    src/app.html  (template, contains data placeholders and /*__GA_ID__*/)
  + src/games.json (360 games, compact JSON)
  + src/postseason.json (completed postseason games, compact JSON)
  + src/taiwan-series.json (Taiwan Series card data)
  + src/taiwan-series-rosters.json (Taiwan Series roster data)
  + tools/ts_hero_sample.json (sample G1 for staging previews)
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
    taiwan_series_rosters = json.loads((ROOT / "src/taiwan-series-rosters.json").read_text(encoding="utf-8"))
    # Sample G1 box score + prediction, used only by the staging previews
    # (?ts_preview=locked|final) and by tools/prerender_ts_hero.py.
    ts_sample = json.loads((ROOT / "tools/ts_hero_sample.json").read_text(encoding="utf-8"))
    ts_preview_js = json.dumps({"game": ts_sample["game"], "prediction": ts_sample["prediction"]}, ensure_ascii=False, separators=(",", ":"))
    assert len(games) == 360 and all(g["d"] for g in games), "games.json must hold 360 dated games"
    required = {"series", "g", "d", "a", "h", "as", "hs", "v", "wp", "lp", "sv", "mvp"}
    assert postseason and all(required <= game.keys() for game in postseason), "postseason.json has incomplete games"
    ts_schedule_required = {"year", "g", "date", "time", "startsAt", "away", "home", "dataReady"}
    # dataReady = the final result is known (enough to settle predictions).
    # The full box score (for 3.賽事回顧與最愛球員) can follow later.
    ts_result_required = {"venue", "awayScore", "homeScore", "decisions", "mvp", "winningRbi", "seriesRecord"}
    ts_box_required = {"teams", "innings", "rhe", "moments", "homeRuns", "duration", "attendance"}
    assert taiwan_series and all(ts_schedule_required <= game.keys() for game in taiwan_series), "taiwan-series.json has incomplete schedule entries"
    assert all(game["g"] == index for index, game in enumerate(taiwan_series, 1)), "taiwan-series.json must contain G1-G7 in order"
    assert all(game["away"] != game["home"] for game in taiwan_series), "Taiwan Series opponents must be different"
    assert all(game.get("dataReady") is False or ts_result_required <= game.keys() for game in taiwan_series), "taiwan-series.json has incomplete result data"
    assert all("teams" not in game or ts_box_required <= game.keys() for game in taiwan_series), "taiwan-series.json has an incomplete box score"
    roster_groups = {"pitchers": 15, "catchers": 3, "infielders": 8, "outfielders": 6}
    assert taiwan_series_rosters.get("year") == 2026 and taiwan_series_rosters.get("series") == "taiwan", "Taiwan Series roster metadata is invalid"
    assert set(taiwan_series_rosters.get("teams", {})) == {"中信兄弟", "味全龍"}, "Taiwan Series rosters must contain both teams"
    for team, roster in taiwan_series_rosters["teams"].items():
        assert all(len(roster.get(group, [])) == count for group, count in roster_groups.items()), f"{team} roster counts are invalid"
        names = [name for group in roster_groups for name in roster[group]]
        assert len(names) == len(set(names)) == 32, f"{team} roster must contain 32 unique players"

    roster_names = {team: {n for grp in roster_groups for n in taiwan_series_rosters["teams"][team][grp]} for team in taiwan_series_rosters["teams"]}
    for game in taiwan_series:
        if not game.get("dataReady"):
            continue
        assert game["awayScore"] != game["homeScore"], f"G{game['g']} cannot be a tie"
        winner = game["away"] if game["awayScore"] > game["homeScore"] else game["home"]
        loser = game["home"] if winner == game["away"] else game["away"]
        checks = {"winningRbi": (game["winningRbi"], winner), "decisions.win": (game["decisions"]["win"], winner),
                  "decisions.loss": (game["decisions"]["loss"], loser), "mvp": (game["mvp"]["name"], winner)}
        if game["decisions"].get("save"):
            checks["decisions.save"] = (game["decisions"]["save"], winner)
        for field, (name, team) in checks.items():
            assert name in roster_names[team], f"G{game['g']} {field} '{name}' is not on the {team} Taiwan Series roster"

    games_js = json.dumps(games, ensure_ascii=False, separators=(",", ":"))
    postseason_js = json.dumps(postseason, ensure_ascii=False, separators=(",", ":"))
    taiwan_series_js = json.dumps(taiwan_series, ensure_ascii=False, separators=(",", ":"))
    taiwan_series_rosters_js = json.dumps(taiwan_series_rosters, ensure_ascii=False, separators=(",", ":"))
    page = tpl.replace("/*__GAMES_JSON__*/", games_js)
    page = page.replace("/*__POSTSEASON_JSON__*/", postseason_js)
    page = page.replace("/*__TAIWAN_SERIES_JSON__*/", taiwan_series_js)
    page = page.replace("/*__TAIWAN_SERIES_ROSTERS_JSON__*/", taiwan_series_rosters_js)
    page = page.replace("/*__TS_PREVIEW_JSON__*/", ts_preview_js)
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
