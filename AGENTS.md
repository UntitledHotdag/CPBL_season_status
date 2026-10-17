# AGENTS.md — CPBL 進場戰績（mybaseballgame.com）

> 給 AI 開發助手（Claude、Codex、Cursor 等）與新加入的開發者閱讀的專案說明。
> 動手改任何東西之前，先讀完「0. 給 AI 的工作守則」與「6. 開發流程」。
> 最後更新：2026-10-16 · 維護者：Johnson Lin（GitHub: UntitledHotdag）

---

## 0. 給 AI 的工作守則（必讀）

1. **不要直接改 `docs/index.html`**。它是建置產物，會被覆蓋。要改網站就改 `src/app.html`，再執行 `python3 tools/build.py`。
2. **一般網站功能維持純前端**；目前唯一核准的後端範圍是台灣大賽匿名預測 API、D1 統計與受 Cloudflare Access 保護的管理架構。不得擴大保存範圍或新增會上傳個資的功能；若需求需要更多伺服器能力，先提出方案與費用評估，經維護者同意才做（見 §8）。
3. **不得使用 CPBL 或各球團的官方 Logo、商標、官方照片**。一般介面的球隊徽章以「一個英文字母＋代表色」自製（見 §5.3）；台灣大賽下載預測圖改用球隊全名，不以 B／W 代替 Logo。
4. **介面文字使用繁體中文（台灣用語）**；程式識別名稱、commit message 使用英文。
5. **使用者的勾選紀錄、名字、照片只存在使用者自己的瀏覽器**；台灣大賽只會送出匿名比分／球員預測與雜湊後的裝置識別。GA 事件不得帶入名字、照片、球員選擇或搜尋字串內容。
6. **只計「進場觀賽」**：轉播、直播不算，文案不得暗示可以登記電視觀賽。
7. 改完務必驗證：手機寬度 390px 與桌機 1280px、淺色與深色模式、頁面不可出現水平捲軸、瀏覽器 console 無錯誤（見 §6.4）。
8. 改動資料（`src/games.json`）只能透過 `tools/parse_cpbl_pdf.py` 重新產生，不要手改；若必須手動修正，要在 commit message 寫明原因與來源。
9. 改了回顧圖繪製（`drawShare` / `shareModel`）或首頁範例卡片後，要重跑 `tools/prerender_wall.py` 更新首頁圖片。
10. 不要 commit：`data/pdf/`（官方 PDF）、`Claude outputs/`（宣傳圖）、`logo/`（官方 Logo，僅供參考，**禁止使用**）。

---

## 1. 產品概要

| 項目 | 內容 |
|---|---|
| 名稱 | CPBL 進場戰績（品牌網址 mybaseballgame.com） |
| 一句話 | 球迷勾選 2026 年中華職棒一軍例行賽「進場看過」的比賽，得到整季觀賽摘要與觀賽勝率，再放上自己拍的球場照片，下載一張 1080×1920 的賽季回顧圖 |
| 初衷 | 季末想用在球場拍的照片＋整季觀賽數據，好好回顧這一季 |
| 目標使用者 | 台灣職棒進場球迷，主要用手機瀏覽（mobile first） |
| 資料範圍 | 2026 一軍例行賽，3/28–10/06，共 360 場；季後挑戰賽已納入完賽場次；台灣大賽已建立 G1–G7 賽程與賽前預測，賽果尚未寫入 |
| 性質 | 球迷自製、非官方網站；與 CPBL 及各球團無隸屬、授權或贊助關係 |

---

## 2. 線上環境與帳號

| 項目 | 值 |
|---|---|
| 正式網址 | https://mybaseballgame.com（另接 `www.mybaseballgame.com`） |
| 主機 | Cloudflare Workers（Static Assets＋僅處理 `/api/*`、`/admin*` 的 Worker），專案名 `cpbl-season-status` |
| 備用網址 | `cpbl-season-status.jjwer210184.workers.dev`（建議在 Cloudflare 停用，避免雙網址） |
| 正式部署 | GitHub `UntitledHotdag/CPBL_season_status`，分支 `main`，Cloudflare 專案 `cpbl-season-status`，網址 `mybaseballgame.com` |
| 測試部署 | 同一 GitHub repository，分支 `staging`，Cloudflare 專案 `cpbl-season-status-staging`，網址 `staging.mybaseballgame.com` |
| 部署輸出 | `docs/` 靜態資源＋`worker/index.js`；D1 migration 必須在 Worker 部署前套用 |
| 網域 | `mybaseballgame.com` 於 Cloudflare Registrar 購買（約 US$10.5／年，需開自動續約） |
| 分析 | Google Analytics 4，評估 ID `G-3NFXSVM2JD`，只在正式網域送資料 |
| 舊環境 | 曾用 GitHub Pages（`/docs`）測試；已改用 Cloudflare，若 Pages 仍開啟可關閉 |
| 成本 | 網域年費＋Cloudflare Workers／D1 免費額度；超過免費額度前須先評估 |

---

## 3. 專案結構

```
CPBL_season_status/
├── AGENTS.md              ← 本文件（AI／開發者說明）
├── CLAUDE.md              ← 指向本文件
├── SYSTEM_DESIGN.md       ← 現行站點架構、使用者路徑、圖卡設計與功能狀態
├── CLOUDFLARE_BACKEND.md  ← Worker／D1／Access 的設定與資料邊界
├── src/
│   ├── app.html           ← 網站原始碼（唯一要手改的前端檔案；含 /*__GAMES_JSON__*/、/*__GA_ID__*/ 佔位符）
│   ├── games.json         ← 360 場例行賽精簡資料（由 parse_cpbl_pdf.py 產生）
│   ├── postseason.json    ← 已完賽季後挑戰賽資料（比分與單場獎項）
│   ├── taiwan-series.json ← 台灣大賽賽程與已完賽圖卡資料
│   └── taiwan-series-rosters.json ← 2026 台灣大賽兩隊 32 人出賽名單（賽前預測候選人）
├── tools/
│   ├── build.py           ← src → docs/index.html（嵌入資料與 GA ID）
│   ├── parse_cpbl_pdf.py  ← 官方月份 PDF → cpbl_2026.csv、standings、src/games.json
│   ├── prerender_wall.py  ← 用網站自己的 Canvas 繪圖預先產生首頁回顧圖與宣傳 PNG
│   └── wall_cards.json    ← 首頁 12 張範例卡片的設定（球隊、場次、照片、取景）
├── worker/index.js        ← 台灣大賽匿名預測 API；社群 API 目前停用
├── migrations/            ← D1 schema（逐場預測、社群保留表、系列賽比分預測）
├── assets/wall-photos/    ← 站長自拍的球場照片（預先繪圖的素材，1600px）
├── docs/                  ← 部署目錄（Cloudflare 直接提供）
│   ├── index.html         ← 建置產物，勿手改
│   └── img/
│       ├── wall/*.jpg     ← 首頁 2.5D 回顧圖牆（12 張，預先算好）
│       ├── photo-brothers.jpg / recap-brothers.jpg ← 首頁「放上照片」區塊
│       └── demo-*.jpg     ← 舊版殘留，未使用，可 git rm
├── cpbl_2026.csv          ← 完整賽程結果表（給人看／其他用途）
├── cpbl_2026_standings.csv← 戰績排名
├── data/pdf/              ← 官方 PDF 放這裡（.gitignore，不進版控）
├── Claude outputs/        ← 宣傳圖等產出（.gitignore）
└── logo/                  ← 官方 Logo 參考（.gitignore，禁止用於網站）
```

---

## 4. 技術架構

- **單一 HTML 前端**：所有 CSS、JS、賽程資料都內嵌在 `docs/index.html`。無框架、無打包工具，純 vanilla JS；匿名預測才呼叫 Worker API。
- **外部資源**：Google Fonts（Manrope、Noto Sans TC）、正式站 GA4 的 `gtag.js`，以及匿名預測所需的 Cloudflare Turnstile。
- **路由**：hash router，包含 `#intro`、`#pick`、`#result`、`#taiwan-series`、`#community`。瀏覽器上一頁可用；`#result` 在沒有勾選時會導回 `#pick`。
- **本機狀態儲存**：

| 位置 | key | 內容 |
|---|---|---|
| localStorage | `cpbl2026-picks` | 已勾選場次編號陣列 |
| localStorage | `cpbl2026-team` | 成果頁版面：球隊全名，或 `NONE`（觀賽摘要） |
| localStorage | `cpbl2026-theme` | `light` / `dark` |
| localStorage | `cpbl2026-name` | 使用者在成果頁輸入的名字 |
| localStorage | `cpbl2026-view` | 選賽頁檢視：`month` / `week` / `list` |
| localStorage | `cpbl2026-taiwan-series-predictions-v2` | 台灣大賽逐場預測與系列賽比分；用於鎖定後重畫、完賽後對答案 |
| localStorage | `cpbl2026-taiwan-series-name-v2` / `cpbl2026-taiwan-series-score-name-v2` | 逐場／系列賽圖卡姓名，只保存在裝置 |
| IndexedDB | DB `cpbl2026`、store `kv`、key `photo` | 壓縮後 JPEG（最長邊 2000px，移除 EXIF/GPS）＋取景 `{fx, fy, z}` |
| IndexedDB | 同 DB，`taiwan-series-v2-photo-<year>-<G>` / `taiwan-series-v2-series-photo-<year>` | 逐場與系列賽各自保存照片與取景，不會上傳 |

- **照片取景模型**：焦點 `fx, fy`（0–1）＋縮放 `z`（≥1，以 cover 為基準）。同一組設定套用到成果頁 16:7 大圖與 9:16 回顧圖。
- **台灣大賽照片編輯**：逐場與系列賽各有 9:16 取景編輯器，支援拖曳、雙指／滑桿縮放、換圖、移除及重開已存照片。預測圖的主要文字從圖面約 40% 以下開始，上方留給照片。
- **回顧圖**：Canvas 2D 繪製 1080×1920 PNG（`drawShare(model, photo)`，資料由 `shareModel(games, team, name)` 產生）。下載方式依環境：Claude Artifact 用 `downloads` capability；手機支援時用 Web Share（可直接分享到 IG）；其他情況 `<a download>`；手機也可長按預覽圖儲存。
- **SEO／分享**：`<link rel="canonical">` 與 Open Graph 標籤指向 `https://mybaseballgame.com/`（尚無 og:image）。

---

## 5. 功能與規則

### 5.1 頁面

| 頁面 | 重點功能 |
|---|---|
| 介紹頁 `#intro` | Hero 主標「你這個賽季，進場看了幾場球？」＋季後挑戰賽更新資訊與快速篩選入口＋2.5D 斜放、緩慢捲動的回顧圖牆（12 張預先算好的 JPG）；「放上這個賽季你最喜歡的照片」區塊（照片 → 回顧圖對照）；三步驟（勾選、選球隊、做成賽季回顧圖）；整季數字；資料來源與免責聲明 |
| 選擇賽事 `#pick` | 三種檢視：**月曆**（預設，格子內為對戰字母小徽章，點日期在下方展開當日卡片）、**周曆**（7 天、左右換週）、**列表**（整季、依月份分段且月份標題 sticky）。篩選：球隊（6 隊）、月份（全季／上半季／下半季／3–10 月）、球場、只看已選、搜尋。右下角「看我的戰績 →」、「清除所有」（7 秒內可復原） |
| 我的戰績 `#result` | 主視覺（可上傳照片並拖曳/縮放取景）→ 名字 → **選擇版面（你支持的球隊）** 下拉 → 觀賽摘要、球隊觀賽勝率或季後挑戰賽專用版面 → **賽季回顧圖卡片**（即時縮圖＋下載）→ 球隊細項、主場觀賽、球場踩點、每月進場 → 最底部「每一場的比賽明細」（上半季、下半季、季後挑戰賽、台灣大賽 TBD）。右下角「← 回到選擇賽事」 |
| 台灣大賽 `#taiwan-series` | G1–G7 逐場預測（每場開賽時間到即鎖定）→ 同裝置保存預測 → 賽果資料標記 `dataReady` 後進入對答案；另有系列賽最終勝場預測、匿名比例圖，以及僅在完賽資料齊全後開放的賽後回顧圖 |
| 社群 `#community` | 目前只顯示「即將上線」；不讀取作品、也不接受 Threads 投稿。管理介面與資料表保留，但 API 同樣停用 |

完整 sitemap、使用者路徑、台灣大賽三種圖卡與後續功能規劃見 [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)。實作狀態以程式碼及資料檔為準，不把「已規劃」當成「已上線」。

### 5.2 統計定義

- **觀賽勝率**＝該隊在使用者進場場次的 勝 ÷（勝＋敗），**和局不計**。
- **全季勝率**：由 360 場全季結果計算的各隊勝率（基準線）。主場隊全季勝率約 .493。
- **幸運指數** d ＝（觀賽勝率 − 全季勝率）× 100 個百分點：
  `福神球迷 ≥ +10`、`好運球迷 ≥ +3`、`平常心 > −3`、`辛苦了 > −10`、其餘 `逆風鐵粉`。該隊進場 **≥ 3 場**才顯示稱號。
- **觀賽摘要（不選球隊）**：進場場數、球場數、看過幾隊、最常看的主場、最常去的球場、最常看到的球隊、進場最多的月份、主場隊在你面前的勝率。同票時取時間較早者。
- **上／下半季**：以場次編號切分，1–180 為上半季、181–360 為下半季（`HALF_END = 180`）。
- **延賽**：原日期顯示唯讀的「延賽」卡片（標示補賽日），補賽日顯示實際比分並標「補」。**保留比賽**（`ok: "s"`）在原日期與續賽日都可勾選（同一場次，只算一次）。
- **最長連勝**：只看使用者進場的場次之間的連勝，不是球隊實際連勝。

### 5.3 設計系統

- 字型：Manrope（數字／英文，含 800 粗體字母標誌）＋ Noto Sans TC。
- 色彩 token 定義在 `:root`（`--ground --panel --ink --muted --accent --accent-fill …`），深色模式由 `prefers-color-scheme` 與 `[data-theme]` 切換。
- **球隊標誌**：圓角方塊＋球隊色＋光影亮邊（立體按鈕感）＋黑體大寫字母；輸球方變灰。

| 球隊 | 字母 | 代表色 `c` | 輔助色 `f`（亮） | 輔助色 `l`（淺色模式文字） |
|---|---|---|---|---|
| 中信兄弟 | B | #F2B705 | #F5C518 | #A8820A |
| 樂天桃猿 | R | #8E1B3A | #D2486E | #8E1B3A |
| 味全龍 | W | #C8102E | #E5414B | #C8102E |
| 台鋼雄鷹 | T | #1E5B45 | #33AD78 | #1E6B4D |
| 統一7-ELEVEn獅 | L | #EE7623 | #F28A2E | #C25A0B |
| 富邦悍將 | G | #1D3D8F | #3F7FEA | #1D4FB8 |

- 成果頁選了球隊版面後，強調色（長條圖、幸運稱號、大圖小標、回顧圖）換成該隊輔助色；觀賽摘要版面用中性色（網頁黑灰、回顧圖米白），避免偏向任何一隊。

### 5.4 賽季回顧圖（1080×1920）

- 上：CPBL / 2026、MY 2026 SEASON、使用者名字。中：照片或球隊色背景（無照片時大字母浮水印）。下（約 y 940–1700，避開 IG 限動介面）：標題、版面標籤、大數字、勝敗／側欄、比較句、**每場色塊**、三格數據。底：`mybaseballgame.com`＋免責小字。
- **每場色塊規則**：球隊版面 → 贏＝該隊輔助色、輸＝灰、和＝空心框。觀賽摘要版面 → **主場贏＝主隊代表色、主場輸＝灰、和＝空心框**。依日期排序，超過兩排自動縮小。

---

## 6. 開發流程

### 6.1 一般修改（前端）

```bash
# 1. 改原始碼
$EDITOR src/app.html
# 2. 建置（嵌入資料與 GA ID）
python3 tools/build.py
# 3. 本機預覽（localhost 不會送 GA）
python3 -m http.server 8000   # 開 http://localhost:8000/docs/
# 4. 驗證（§6.4）後提交並推送
git add src docs && git commit -m "Short imperative summary" && git push
```

推送到 `main` 後 Cloudflare 會自動部署（約 1–2 分鐘）。確認方式：Cloudflare → Workers & Pages → `cpbl-season-status` → Deployments 最新一筆成功，再用無痕視窗開正式網址。

### 6.2 更新賽程資料

1. 從 CPBL 官網下載各月一軍例行賽 PDF，放進 `data/pdf/`（檔名須含 `2026MM`；同月份重新下載時只保留最新一份）。
2. `pip install pdfplumber && python3 tools/parse_cpbl_pdf.py`
   - 會輸出 `cpbl_2026.csv`、`cpbl_2026_standings.csv`、`src/games.json`，並驗證：360 場齊全、每天最多 3 場、同日同球場不重複、每場都有日期。驗證失敗會中止。
3. `python3 tools/build.py` → 預覽 → commit（訊息註明資料更新範圍）。

### 6.3 更新首頁範例回顧圖／宣傳圖

1. 照片放 `assets/wall-photos/<name>.jpg`（只能用站長自己拍的照片）。
2. 編輯 `tools/wall_cards.json`：`team`（或 `null`＝觀賽摘要）、`games`（樣本場次）、`photo`、`fx/fy/z`（主角要落在畫面上半部，數據區在下半部）。範例稱號要分散（福神／好運／平常心／辛苦了／逆風），不要全部福神。
3. `python3 tools/build.py && pip install playwright && playwright install chromium && python3 tools/prerender_wall.py`
   - 輸出 `docs/img/wall/*.jpg`、`docs/img/recap-brothers.jpg`，以及 `Claude outputs/promo/recap-*.png`（社群用 1080×1920）。
   - 需能連到 Google Fonts，否則字型會退回系統字。
4. 若卡片名稱有增減，同步修改 `src/app.html` 裡的 `WALL_IMAGES` 陣列。

### 6.4 驗證清單

- [ ] 390×844（手機）與 1280×900（桌機）兩種寬度，`document.documentElement.scrollWidth` 等於視窗寬（無水平捲動）
- [ ] 淺色、深色模式都可讀
- [ ] console 無錯誤；網路面板無 4xx/5xx
- [ ] 主要流程：介紹 → 選賽（月曆／周曆／列表都試）→ 勾選 → 戰績 → 切換版面 → 上傳照片 → 下載回顧圖
- [ ] 台灣大賽：逐場／系列賽照片各自上傳、取景、重開編輯與下載；預測時間窗、鎖定、`dataReady` 後對答案；社群保持停用
- [ ] 改統計邏輯時，用 Python 對 `src/games.json` 獨立重算一次並比對頁面數字
- [ ] GA：正式網址加 `?ga_debug=1`，在 GA4 → DebugView 確認事件

### 6.5 與 AI 協作的方式（目前實際流程）

- 維護者在 Claude（Cowork）對話中提出需求；AI 先釐清需求（必要時給選項），修改 `src/app.html`／工具腳本，建置並用 Playwright 在 390px 與 1280px 截圖驗證，再把檔案寫回本機專案資料夾。
- **由維護者本人執行 `git add / commit / push`**。AI 會在回覆中附上對應指令。
- 注意：若維護者同時用編輯器開著 `docs/index.html`，編輯器存檔可能覆蓋 AI 寫入的版本（曾發生過）。推送前用 `git diff --stat` 確認。

### 6.6 測試站發布流程

1. 新功能從 `staging` 建立 `feature/<name>` 分支開發。
2. 完成修改後執行 `python3 tools/build.py`，並按 §6.4 驗證。
3. 若新增 D1 migration，先執行 `npm run db:migrate:staging`；Cloudflare Git 部署指令也必須先套用 migration 再執行 `wrangler deploy`。
4. 將功能分支合併至 `staging`，推送後由 Cloudflare 自動部署至 `staging.mybaseballgame.com`。
5. 測試站驗收通過後，將 `staging` 合併至 `main`；正式環境先套用 production migration，再部署 Worker。
6. `docs/_headers` 只針對 `staging.mybaseballgame.com` 回傳 `X-Robots-Tag: noindex, nofollow, noarchive`，不影響正式網域。
7. 測試站應使用 Cloudflare Access 限制存取；現行 GA hostname allowlist 不包含 staging 子網域，不會傳送 GA 事件。

---

## 7. Git 與部署規範

- `main` 是正式分支，推送後部署至 `mybaseballgame.com`。
- `staging` 是長期測試分支，推送後部署至 `staging.mybaseballgame.com`；測試通過後才合併至 `main`。
- 新功能分支命名為 `feature/<name>`，由 `staging` 建立並優先透過 Cloudflare Preview 或測試站驗證。
- Commit message：英文、祈使句、一行摘要，例如 `Picker: month / week / list views`、`Fix 4 games missing dates`。資料修正要寫原因。
- `.gitignore`：`.DS_Store`、`logo/`、`Claude outputs/`、`.venv/`、`__pycache__/`、`data/pdf/`。
- 歷史上 `logo/` 曾被提交過；正式擴大宣傳前可考慮清理 git 歷史。
- 回滾：`git revert <commit> && git push`，Cloudflare 會部署回退後的版本。

---

## 8. 成本與限制

- 靜態資源使用 Cloudflare Workers Static Assets；目前已加入 Worker 與 D1 供匿名預測，流量／儲存需監控免費額度。再新增 `functions/`、KV、R2 或擴大資料保存範圍前須先評估成本與隱私。
- 免費方案若用量超標只會回 429，不會自動扣款；帳號不應有付費訂閱（Billing → Subscriptions 應只有 Free）。
- 單檔上限 25 MiB、每站 20,000 檔；`docs/` 目前約 1.1 MB。

---

## 9. 分析（GA4）

- `GA_ID` 只在 `location.hostname` 為 `mybaseballgame.com` / `www.mybaseballgame.com` 時啟用；hash 換頁時送**虛擬 page_view**（`/intro`、`/pick`、`/result`），`send_page_view: false`。
- GA4 後台「加強型評估」已關閉「頁面根據瀏覽器記錄事件而變更」，避免重複計算；建議也關閉「表單互動」。
- 網址加 `?ga_debug=1` 會開 `debug_mode`，事件出現在 DebugView。

| 事件 | 觸發 | 參數 |
|---|---|---|
| `page_view` | 換頁（虛擬） | `page_title`, `page_location`, `page_path` |
| `cta_click` | 主要按鈕 | `cta_location`（intro_hero / intro_playoff_update / intro_end / pick_footer / result_footer）, `cta_target`, `picks_total` |
| `game_pick` / `game_unpick` | 勾選／取消 | `game_no`, `picks_total` |
| `picks_clear` / `picks_clear_undo` | 清除所有／復原 | `picks_total` |
| `filter_change` / `filter_reset` | 篩選 | `filter_type`（team / month / venue / only_picked / search）, `filter_value`（搜尋只記 `(text)`） |
| `view_change` | 月曆／周曆／列表 | `view` |
| `team_view_change` | 成果頁版面 | `view`（球隊字母或 `summary`） |
| `photo_upload` / `photo_confirm` / `photo_remove` | 照片 | `zoom`（confirm） |
| `share_open` | 開啟回顧圖預覽 | `view`, `has_photo`, `picks_total` |
| `share_save` | 儲存／分享回顧圖 | `method`（download / native_share / claude_downloads） |
| `ts_card_save` | 儲存／分享台灣大賽圖卡 | `card`（prediction / answer / series / game-summary / fan-pick）、`method`（download / native_share / cancelled） |
| `ts_answer_reveal` | 賽後結算面板揭曉 | `game_no`、`hits`（0–5） |
| `theme_toggle` | 深淺色 | `theme` |

已建立的事件範圍自訂維度：`filter_type`、`filter_value`、`view`、`method`、`cta_location`。

---

## 10. 已知問題與坑

- **PDF 換頁日期遺失**：新頁第一列可能沒有日期 → 解析時日期要跨表格、跨頁延續（已修正，場次 233/234/290/348）。
- **`confirm()` / `window.print()`** 在 Claude Artifact 等 sandbox 會被擋 → 不要用阻斷式對話框；「清除所有」改用復原提示。
- **日期運算**一律用 UTC（`new Date(iso + "T00:00:00Z")`），避免時區造成差一天。
- **快取**：推送後若看不到新版，先確認 Cloudflare 部署完成，再強制重新整理或用無痕視窗。
- 範例照片中可見球員與贊助商標誌（現場自拍）；啦啦隊員特寫因肖像權風險**未使用**。
- 季後挑戰賽完賽資料放在 `src/postseason.json`；單場獎項以官方 PDF 的 `wp`、`lp`、`sv`、`mvp` 為準，另有可靠來源時可補選填的 `rbi`。台灣大賽賽程放在 `src/taiwan-series.json`；未完賽維持 `dataReady: false` 且不得填入測試比分，正式賽果欄位補齊後才改為 `true`。
- **預測時間窗**：逐場預測在各場 `startsAt` 當下關閉；系列賽比分預測在 G1 `startsAt` 當下關閉。前端狀態只負責顯示，Worker 必須用同一規則再次驗證。
- **社群功能暫停中**：前端只顯示「即將上線」，`worker/index.js` 的 `COMMUNITY_FEATURE_ENABLED` 維持 `false`，公開作品、Threads 投稿與管理 API 都回傳 `503 community_coming_soon`。確認資料寫入與審核流程穩定前，不要開啟。

---

## 11. 開發歷程

| 階段 | 內容 |
|---|---|
| 起點 | 原想用 Python 爬蟲抓 CPBL 官網賽果（`stats.cpbl.com.tw`），因網路環境封鎖無法使用，改為手動下載每月官方 PDF |
| 資料 | `pdfplumber` 表格解析 → `cpbl_2026.csv`（360 場）；處理 rowspan 合併日期、延賽／保留、換頁日期；計算戰績排名 |
| v0 海報 | 最初做「勾選場次 → A4/A3 戰績海報」，含官方 Logo 與上傳 Logo；因排版難以穩定輸出與侵權風險而放棄 |
| 轉型 | 改為「勾選 → 觀賽摘要＋觀賽勝率 → 9:16 分享圖」，mobile first；Logo 改為自製字母標誌；純前端、不存使用者資料 |
| 結構 | 3 屏介紹頁＋右下角按鈕切換頁面；成果頁可上傳主視覺照片與取景編輯器（IndexedDB 本機保存） |
| M4 | Canvas 產生 1080×1920 回顧圖，支援 downloads / Web Share / 下載 |
| 上線 | GitHub（`docs/`）→ GitHub Pages 測試 → Cloudflare Workers 靜態部署 → GA4 埋點（虛擬頁面＋事件、DebugView）→ 購買 mybaseballgame.com |
| 體驗迭代 | 月份／球隊／球場篩選、2.5D 回顧圖牆（改為預先算好）、成果頁預設觀賽摘要＋「選擇版面」、球隊輔助色、範例稱號多樣化、清除所有＋復原、列表月份分段、月曆／周曆檢視、觀賽摘要色塊改為主場勝負 |
| 文件化 | 原始碼與工具腳本移入版控（`src/`、`tools/`），新增本文件 |

---

## 12. Roadmap

### 短期（1–2 週，宣傳期）
- [ ] 手機篩選列可收合（目前佔畫面約 1/3）
- [ ] 回顧圖色塊加圖例；網頁成果頁也顯示同一條色塊
- [ ] Open Graph 預覽圖（1200×630）
- [ ] 停用 workers.dev 網址、確認 GitHub Pages 已關閉、刪除 `docs/img/demo-*.jpg`
- [ ] 依 GA 數據（`view_change`、`share_open`／`share_save` 轉換率、`picks_clear_undo` 比例）調整介面

### 中期（季後賽～下季開打前）
- [ ] 隨賽程補齊台灣大賽完賽資料並驗證逐場對答案
- [ ] 社群投稿／審核流程完成資料寫入、嵌入與濫用防護測試後，再由維護者決定是否開放
- [ ] ibon 適用的列印海報版型、尺寸與實際列印驗證；不得直接放大 9:16 手機圖卡
- [ ] 應援捐款：先確認金流、費率、隱私及法律責任，再決定實作方式
- [ ] 多賽季架構：資料改為 `src/games-2027.json` 等，localStorage key 依年份分開，網址或選單切換賽季
- [ ] 解析流程自動化（若官方資料可程式化取得，改回爬蟲並排程更新）
- [ ] 回顧圖多種版型（例如方形 1:1 貼文版）
- [ ] 匯出／匯入勾選紀錄（換手機不遺失，仍不需伺服器）

### 長期（需評估成本與隱私）
- [ ] 帳號與雲端同步、球迷排行榜、同場球迷配對——都需要後端與資料保存，須先完成費用、隱私與法務評估
- [ ] 二軍或其他聯盟支援

---

## 13. 名詞對照

| 中文 | 程式中 |
|---|---|
| 場次編號 | `n` |
| 比賽日期／原定日期 | `d` / `od` |
| 客隊／主隊 | `a` / `h` |
| 客隊得分／主隊得分 | `as` / `hs` |
| 球場 | `v` |
| 保留比賽 | `ok: "s"` |
| 選賽頁單位（含延賽殘影） | `SLOTS`（kind: normal / makeup / resumed / suspended / postponed） |
| 觀賽摘要版面 | `team = null` / `"NONE"` |
