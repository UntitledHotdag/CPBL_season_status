#!/usr/bin/env python3
"""Parse the monthly CPBL 一軍例行賽 schedule/result PDFs into the site's data files.

Input : data/pdf/*2026MM*.pdf  — one PDF per month, downloaded by hand from the CPBL
        official site (the stats site blocks scripted access, so no scraper).
        If a month was re-downloaded, keep only the newest file for that month.
Output: cpbl_2026.csv            — full per-game table (human-readable)
        cpbl_2026_standings.csv  — team standings derived from it
        src/games.json           — compact data embedded into the site by tools/build.py

Usage:  python3 tools/parse_cpbl_pdf.py [--pdf-dir data/pdf]
Needs:  pip install pdfplumber

Parsing notes (learned the hard way):
- Use page.extract_tables(): plain text extraction mis-assigns rowspan-merged dates.
- A page can start mid-day with an empty date cell -> carry current_date across
  tables AND pages within one file (games 233/234/290/348 were dateless before).
- A postponed (延賽) / suspended (保留) game appears on its original date as
  "A VS. B" with the note, and later on the make-up date with a score; we keep the
  scored row and remember the earliest original date as orig_date.
"""
import argparse, re, csv, json
from pathlib import Path
from collections import Counter, defaultdict
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--pdf-dir", default=str(ROOT / "data/pdf"))
args = ap.parse_args()
OUT = ROOT / "cpbl_2026.csv"
TEAMS = {"中信兄弟","樂天桃猿","味全龍","台鋼雄鷹","統一7-ELEVEn獅","富邦悍將"}
date_re = re.compile(r"(\d{1,2})/(\d{1,2})")

def strip_count(s):
    return re.sub(r"\(\d+\)$", "", (s or "").strip()).strip()

def grab(key, detail):
    m = re.search(rf"{key}[:：]\s*([^\|｜]+?)(?=\s*[\|｜]|$)", detail or "")
    return strip_count(m.group(1)) if m else ""

rows_by_game = {}
orig_kind = {}
orig_dates = {}  # game_no -> earliest 延賽 date (before makeup)

by_month = {}
for p in sorted(Path(args.pdf_dir).glob("*.pdf"), key=lambda p: p.stat().st_mtime):
    m = re.search(r"2026(\d{2})", p.name)
    if m: by_month[m.group(1)] = p          # newest file wins for a month
FILES = [by_month[k] for k in sorted(by_month)]
assert FILES, f"no *2026MM*.pdf found in {args.pdf_dir}"
print("PDFs:", ", ".join(p.name for p in FILES))
for f in FILES:
    f = str(f)
    m = re.search(r"2026(\d{2})", f)
    month = int(m.group(1)) if m else None

    with pdfplumber.open(f) as pdf:
        current_date = None   # carried across tables/pages: a page can start mid-day
        for page in pdf.pages:
            tables = page.extract_tables() or []
            for tbl in tables:
                for row in tbl:
                    if not row or all(not (c or "").strip() for c in row):
                        continue
                    cols = [((c or "").strip()) for c in row]
                    # Skip header row
                    if cols and cols[0] == "日期" and any("場次" in c for c in cols):
                        continue

                    # Date column
                    d = cols[0] if cols else ""
                    dm = date_re.match(d)
                    if dm:
                        current_date = f"2026-{int(dm.group(1)):02d}-{int(dm.group(2)):02d}"

                    # game_no column
                    gn_raw = cols[1] if len(cols) > 1 else ""
                    if not gn_raw.isdigit():
                        continue
                    gn = int(gn_raw)

                    teams_col = cols[2] if len(cols) > 2 else ""
                    venue_col = cols[3] if len(cols) > 3 else ""
                    detail_col = cols[4] if len(cols) > 4 else ""

                    # Parse "A X :Y B" or "A VS. B"
                    mplayed = re.match(r"^(\S+)\s+(\d+)\s*:\s*(\d+)\s+(\S+)$", teams_col)
                    mvs = re.match(r"^(\S+)\s+VS\.?\s+(\S+)$", teams_col)
                    if mplayed:
                        away, aw, hs, home = mplayed.group(1), int(mplayed.group(2)), int(mplayed.group(3)), mplayed.group(4)
                        if away not in TEAMS or home not in TEAMS:
                            continue
                        # Duration from venue col: "洲際 3H13M"
                        mdur = re.search(r"(\d+H\d+M)", venue_col)
                        duration = mdur.group(1) if mdur else ""
                        venue = re.sub(r"\s*\d+H\d+M\s*$", "", venue_col).strip()
                        winner = away if aw > hs else home if hs > aw else "和局"
                        status = "延賽" if "延賽" in detail_col else "保留" if "保留" in detail_col else "已結束"
                        rows_by_game[gn] = {
                            "game_no": gn, "date": current_date or "", "month": month,
                            "away_team": away, "home_team": home,
                            "away_score": aw, "home_score": hs,
                            "venue": venue, "duration": duration, "status": status, "winner": winner,
                            "win_pitcher": grab("勝投", detail_col),
                            "lose_pitcher": grab("敗投", detail_col),
                            "save_pitcher": grab("救援成功", detail_col),
                            "mvp": grab("MVP", detail_col),
                        }
                    elif mvs:
                        away, home = mvs.group(1), mvs.group(2)
                        if away not in TEAMS or home not in TEAMS:
                            continue
                        # Track the earliest 延賽 date as the original scheduled date
                        if ("延賽" in detail_col or "保留" in detail_col) and current_date and gn not in orig_dates:
                            orig_dates[gn] = current_date
                            orig_kind[gn] = "保留" if "保留" in detail_col else "延賽"
                        # Don't overwrite completed game
                        if gn in rows_by_game and rows_by_game[gn]["status"] == "已結束":
                            continue
                        venue = venue_col.strip()
                        status = "延賽" if "延賽" in detail_col else "保留" if "保留" in detail_col else "未開打"
                        rows_by_game[gn] = {
                            "game_no": gn, "date": current_date or "", "month": month,
                            "away_team": away, "home_team": home,
                            "away_score": "", "home_score": "",
                            "venue": venue, "duration": "", "status": status, "winner": "",
                            "win_pitcher": "", "lose_pitcher": "", "save_pitcher": "", "mvp": "",
                        }

uniq = sorted(rows_by_game.values(), key=lambda x: x["game_no"])
# Attach orig_date only when it differs from current date and game is played
for r in uniq:
    gn = r["game_no"]
    orig = orig_dates.get(gn, "")
    r["orig_date"] = orig if (orig and orig != r["date"]) else ""
    r["orig_kind"] = orig_kind.get(gn, "") if r["orig_date"] else ""

fields = ["game_no","date","orig_date","orig_kind","month","away_team","home_team","away_score","home_score",
          "venue","duration","status","winner","win_pitcher","lose_pitcher","save_pitcher","mvp"]
with OUT.open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(uniq)

# ---- src/games.json (site data) ----
games = []
for r in uniq:
    if r["status"] != "已結束" or r["away_score"] == "":
        continue
    e = {"n": r["game_no"], "d": r["date"], "a": r["away_team"], "h": r["home_team"],
         "as": int(r["away_score"]), "hs": int(r["home_score"]), "v": r["venue"]}
    if r["orig_date"]: e["od"] = r["orig_date"]
    if r["orig_kind"] == "保留": e["ok"] = "s"     # suspended: selectable on both dates
    games.append(e)
(ROOT / "src/games.json").write_text(json.dumps(games, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"src/games.json: {len(games)} games")

# ---- standings ----
st = defaultdict(lambda: {"w": 0, "l": 0, "t": 0, "rs": 0, "ra": 0})
for g in games:
    a, h = st[g["a"]], st[g["h"]]
    a["rs"] += g["as"]; a["ra"] += g["hs"]; h["rs"] += g["hs"]; h["ra"] += g["as"]
    if g["as"] > g["hs"]: a["w"] += 1; h["l"] += 1
    elif g["hs"] > g["as"]: h["w"] += 1; a["l"] += 1
    else: a["t"] += 1; h["t"] += 1
table = sorted(st.items(), key=lambda kv: -kv[1]["w"] / max(1, kv[1]["w"] + kv[1]["l"]))
lw, ll = table[0][1]["w"], table[0][1]["l"]
with (ROOT / "cpbl_2026_standings.csv").open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["team", "games", "wins", "losses", "ties", "win_pct", "games_behind", "runs_scored", "runs_allowed", "run_diff"])
    for t, s in table:
        gb = ((lw - s["w"]) + (s["l"] - ll)) / 2
        w.writerow([t, s["w"] + s["l"] + s["t"], s["w"], s["l"], s["t"], round(s["w"] / (s["w"] + s["l"]), 3),
                    "—" if gb == 0 else f"{gb:g}", s["rs"], s["ra"], s["rs"] - s["ra"]])
print("cpbl_2026_standings.csv written")

# Sanity: max games per date and per venue+date
by_date = {}
for r in uniq:
    if r["status"] == "已結束" and r["date"]:
        by_date.setdefault(r["date"], []).append(r)
overloaded = {d:len(v) for d,v in by_date.items() if len(v) > 3}
print(f"總場次：{len(uniq)}")
print(f"已結束：{sum(1 for r in uniq if r['status']=='已結束')}")
missing = sorted(set(range(1, max(r['game_no'] for r in uniq)+1)) - {r['game_no'] for r in uniq})
print(f"缺場次：{missing}")
print(f"單日場次 >3 的日期（應為 0 個）：{overloaded}")

# Venue clash within a date (should be 0)
clashes = []
for d, games in by_date.items():
    vc = Counter(g["venue"] for g in games)
    for v, n in vc.items():
        if n > 1:
            clashes.append((d, v, n))
print(f"同日同場地衝突（應為 0 個）：{len(clashes)}")
for c in clashes[:5]:
    print("  ", c)

assert not overloaded and not clashes and not missing, "validation failed — inspect the PDFs"
print("validation OK")
