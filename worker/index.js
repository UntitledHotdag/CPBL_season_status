import taiwanSeriesGames from "../src/taiwan-series.json" with { type: "json" };
import taiwanSeriesRosters from "../src/taiwan-series-rosters.json" with { type: "json" };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};
const TEAM_NAMES = new Set([
  "中信兄弟",
  "樂天桃猿",
  "味全龍",
  "台鋼雄鷹",
  "統一7-ELEVEn獅",
  "富邦悍將",
]);
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ADMIN_STATUSES = new Set(["pending", "approved", "rejected"]);
const COMMUNITY_FEATURE_ENABLED = false;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const accessKeysCache = new Map();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function apiError(code, status = 400) {
  return json({ ok: false, error: code }, status);
}

function base64UrlBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlJson(value) {
  try {
    return JSON.parse(textDecoder.decode(base64UrlBytes(value)));
  } catch {
    return null;
  }
}

function normalizeAccessIssuer(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  return raw.startsWith("https://") ? raw : `https://${raw}`;
}

function allowedAdminEmails(env) {
  return new Set(String(env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

async function accessKeys(issuer) {
  const cached = accessKeysCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return [];
  const data = await response.json();
  const keys = Array.isArray(data.keys) ? data.keys : [];
  accessKeysCache.set(issuer, { keys, expiresAt: Date.now() + 60 * 60 * 1000 });
  return keys;
}

export async function verifyAdminAccess(request, env, now = Date.now()) {
  const allowed = allowedAdminEmails(env);
  if (!allowed.size) return null;

  if (env.ENVIRONMENT === "development" && env.ADMIN_TEST_MODE === "true") {
    const email = String(request.headers.get("x-admin-test-email") || env.ADMIN_TEST_EMAIL || "").trim().toLowerCase();
    return allowed.has(email) ? { email } : null;
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  const issuer = normalizeAccessIssuer(env.ACCESS_TEAM_DOMAIN);
  const audience = String(env.ACCESS_AUD || "").trim();
  if (!token || !issuer || !audience) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = base64UrlJson(parts[0]);
  const payload = base64UrlJson(parts[1]);
  if (!header || !payload || header.alg !== "RS256" || !header.kid) return null;

  const email = String(payload.email || "").trim().toLowerCase();
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const nowSeconds = Math.floor(now / 1000);
  if (!allowed.has(email) || !audiences.includes(audience)) return null;
  if (normalizeAccessIssuer(payload.iss) !== issuer) return null;
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) return null;
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds + 60) return null;

  try {
    const jwk = (await accessKeys(issuer)).find((key) => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlBytes(parts[2]),
      textEncoder.encode(`${parts[0]}.${parts[1]}`),
    );
    return valid ? { email } : null;
  } catch {
    return null;
  }
}

function gameId(game) {
  return `${game.year}-taiwan-series-g${game.g}`;
}

function findGame(year, gameNo) {
  return taiwanSeriesGames.find((game) => game.year === Number(year) && game.g === Number(gameNo));
}

export function predictionWindowOpen(game, env, now = new Date()) {
  if (!game?.startsAt || game.dataReady) return false;
  const startsAt = Date.parse(game.startsAt);
  const current = now.getTime();
  return Number.isFinite(startsAt) && current < startsAt;
}

export function validatePrediction(game, input) {
  if (!game || !input || typeof input !== "object") return { error: "invalid_prediction" };
  const awayScore = Number(input.awayScore);
  const homeScore = Number(input.homeScore);
  if (!Number.isInteger(awayScore) || !Number.isInteger(homeScore) || awayScore < 0 || homeScore < 0 || awayScore > 30 || homeScore > 30) {
    return { error: "invalid_score" };
  }
  if (awayScore === homeScore) return { error: "tie_not_allowed" };

  const winnerTeam = awayScore > homeScore ? game.away : game.home;
  const loserTeam = winnerTeam === game.away ? game.home : game.away;
  const rosterTeams = taiwanSeriesRosters.year === game.year ? taiwanSeriesRosters.teams : {};
  const winner = rosterTeams[winnerTeam];
  const loser = rosterTeams[loserTeam];
  if (!winner || !loser) return { error: "invalid_game_roster" };

  const winnerBatters = new Set([...winner.catchers, ...winner.infielders, ...winner.outfielders]);
  const winnerPitchers = new Set(winner.pitchers);
  const loserPitchers = new Set(loser.pitchers);
  const winnerPlayers = new Set([...winnerBatters, ...winnerPitchers]);
  const rbi = String(input.rbi || "");
  const winningPitcher = String(input.win || "");
  const losingPitcher = String(input.loss || "");
  const mvp = String(input.mvp || "");

  if (!winnerBatters.has(rbi)) return { error: "rbi_must_be_winner" };
  if (!winnerPitchers.has(winningPitcher)) return { error: "winning_pitcher_must_be_winner" };
  if (!loserPitchers.has(losingPitcher)) return { error: "losing_pitcher_must_be_loser" };
  if (!winnerPlayers.has(mvp)) return { error: "mvp_must_be_winner" };

  return {
    value: {
      winnerTeam,
      awayScore,
      homeScore,
      rbi,
      winningPitcher,
      losingPitcher,
      mvp,
    },
  };
}

export function validateSeriesPrediction(input) {
  if (!input || typeof input !== "object") return { error: "invalid_series_score" };
  const brothersWins = Number(input.brothersWins);
  const dragonsWins = Number(input.dragonsWins);
  const valid = Number.isInteger(brothersWins) && Number.isInteger(dragonsWins)
    && ((brothersWins === 4 && dragonsWins >= 0 && dragonsWins <= 3)
      || (dragonsWins === 4 && brothersWins >= 0 && brothersWins <= 3));
  return valid ? { value: { brothersWins, dragonsWins } } : { error: "invalid_series_score" };
}

export function normalizeThreadsUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!["threads.com", "www.threads.com", "threads.net", "www.threads.net"].includes(host)) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!/^\/(?:@[^/]+\/post\/[A-Za-z0-9_-]+|t\/[A-Za-z0-9_-]+)$/.test(path)) return null;
  return `https://www.threads.com${path}/`;
}

export function sanitizeThreadsEmbed(value) {
  const html = String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?\s*>/gi, "")
    .trim();
  if (!html.startsWith("<blockquote") || !html.endsWith("</blockquote>")) return null;
  if (!/text-post-media/.test(html)) return null;
  if (/<(?:iframe|object|embed|form|input|style)\b/i.test(html)) return null;
  if (/\son[a-z]+\s*=/i.test(html) || /javascript\s*:/i.test(html)) return null;
  return html.length <= 50000 ? html : null;
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20000) throw new Error("payload_too_large");
  return request.json();
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function verifyTurnstile(token, env, expectedAction) {
  if (env.ENVIRONMENT === "development" && env.TURNSTILE_TEST_MODE === "true" && token === "test-token") return true;
  if (!env.TURNSTILE_SECRET_KEY || !token) return false;
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  const response = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && (!result.action || result.action === expectedAction);
}

async function hashAnonymousId(value, salt) {
  const raw = String(value || "");
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(raw) || !salt) return null;
  const bytes = new TextEncoder().encode(`${salt}:${raw}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function predictionSummary(url, env) {
  const game = findGame(url.searchParams.get("year"), url.searchParams.get("game"));
  if (!game) return apiError("game_not_found", 404);
  const query = await env.DB.prepare(
    "SELECT winner_team, COUNT(*) AS votes FROM predictions WHERE season = ? AND series = 'taiwan' AND game_id = ? GROUP BY winner_team",
  ).bind(game.year, gameId(game)).all();
  const votes = { [game.away]: 0, [game.home]: 0 };
  for (const row of query.results || []) {
    if (Object.hasOwn(votes, row.winner_team)) votes[row.winner_team] = Number(row.votes) || 0;
  }
  const total = Object.values(votes).reduce((sum, count) => sum + count, 0);
  const minimum = Math.max(1, Number(env.POLL_MIN_SAMPLE) || 5);
  const visible = total >= minimum;
  return json({ ok: true, gameId: gameId(game), total, minimum, visible, votes: visible ? votes : null });
}

async function submitPrediction(request, env) {
  if (!sameOrigin(request)) return apiError("origin_not_allowed", 403);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return apiError("invalid_json");
  }
  const game = findGame(body.year, body.game);
  if (!game) return apiError("game_not_found", 404);
  if (!predictionWindowOpen(game, env)) return apiError("prediction_closed", 403);
  if (!(await verifyTurnstile(body.turnstileToken, env, "submit_prediction"))) return apiError("turnstile_failed", 403);
  const voterHash = await hashAnonymousId(body.anonymousId, env.ANON_HASH_SALT);
  if (!voterHash) return apiError("invalid_anonymous_id");
  const checked = validatePrediction(game, body.prediction);
  if (checked.error) return apiError(checked.error);
  const value = checked.value;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO predictions (
       season, series, game_id, voter_hash, winner_team, away_score, home_score,
       rbi_player, winning_pitcher, losing_pitcher, mvp_player, created_at, updated_at
     ) VALUES (?, 'taiwan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(season, series, game_id, voter_hash) DO UPDATE SET
       winner_team = excluded.winner_team,
       away_score = excluded.away_score,
       home_score = excluded.home_score,
       rbi_player = excluded.rbi_player,
       winning_pitcher = excluded.winning_pitcher,
       losing_pitcher = excluded.losing_pitcher,
       mvp_player = excluded.mvp_player,
       updated_at = excluded.updated_at`,
  ).bind(
    game.year,
    gameId(game),
    voterHash,
    value.winnerTeam,
    value.awayScore,
    value.homeScore,
    value.rbi,
    value.winningPitcher,
    value.losingPitcher,
    value.mvp,
    now,
    now,
  ).run();
  return json({ ok: true, gameId: gameId(game), winner: value.winnerTeam });
}

async function seriesPredictionSummary(url, env) {
  const year = Number(url.searchParams.get("year"));
  const firstGame = taiwanSeriesGames.find((game) => game.year === year && game.g === 1);
  if (!firstGame) return apiError("game_not_found", 404);
  const query = await env.DB.prepare(
    "SELECT brothers_wins, dragons_wins, COUNT(*) AS votes FROM series_predictions WHERE season = ? AND series = 'taiwan' GROUP BY brothers_wins, dragons_wins ORDER BY votes DESC, brothers_wins DESC",
  ).bind(year).all();
  const scores = (query.results || []).map((row) => ({
    brothersWins: Number(row.brothers_wins),
    dragonsWins: Number(row.dragons_wins),
    votes: Number(row.votes) || 0,
  }));
  const total = scores.reduce((sum, score) => sum + score.votes, 0);
  const minimum = Math.max(1, Number(env.POLL_MIN_SAMPLE) || 5);
  const visible = total >= minimum;
  return json({ ok: true, year, total, minimum, visible, scores: visible ? scores : null });
}

async function submitSeriesPrediction(request, env) {
  if (!sameOrigin(request)) return apiError("origin_not_allowed", 403);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return apiError("invalid_json");
  }
  const firstGame = taiwanSeriesGames.find((game) => game.year === Number(body.year) && game.g === 1);
  if (!firstGame) return apiError("game_not_found", 404);
  if (!predictionWindowOpen(firstGame, env)) return apiError("series_prediction_closed", 403);
  if (!(await verifyTurnstile(body.turnstileToken, env, "submit_series_prediction"))) return apiError("turnstile_failed", 403);
  const voterHash = await hashAnonymousId(body.anonymousId, env.ANON_HASH_SALT);
  if (!voterHash) return apiError("invalid_anonymous_id");
  const checked = validateSeriesPrediction(body.prediction);
  if (checked.error) return apiError(checked.error);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO series_predictions (
       season, series, voter_hash, brothers_wins, dragons_wins, created_at, updated_at
     ) VALUES (?, 'taiwan', ?, ?, ?, ?, ?)
     ON CONFLICT(season, series, voter_hash) DO UPDATE SET
       brothers_wins = excluded.brothers_wins,
       dragons_wins = excluded.dragons_wins,
       updated_at = excluded.updated_at`,
  ).bind(
    firstGame.year,
    voterHash,
    checked.value.brothersWins,
    checked.value.dragonsWins,
    now,
    now,
  ).run();
  return json({ ok: true, year: firstGame.year, ...checked.value });
}

async function threadsEmbed(url) {
  const endpoint = `https://graph.threads.com/oembed?omitscript=true&maxwidth=550&url=${encodeURIComponent(url)}`;
  try {
    const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const data = await response.json();
    const html = sanitizeThreadsEmbed(data.html);
    if (!html) return null;
    return {
      html,
      authorName: String(data.author_name || "Threads 球迷").slice(0, 100),
    };
  } catch {
    return null;
  }
}

async function listCommunity(url, env) {
  const team = url.searchParams.get("team") || "";
  if (team && !TEAM_NAMES.has(team)) return apiError("invalid_team");
  const limit = Math.max(1, Math.min(24, Number(url.searchParams.get("limit")) || 12));
  const sql = team
    ? "SELECT id, threads_url, team, game_id, author_name, embed_html, created_at FROM community_submissions WHERE status = 'approved' AND team = ? ORDER BY moderated_at DESC, id DESC LIMIT ?"
    : "SELECT id, threads_url, team, game_id, author_name, embed_html, created_at FROM community_submissions WHERE status = 'approved' ORDER BY moderated_at DESC, id DESC LIMIT ?";
  const statement = env.DB.prepare(sql);
  const result = team ? await statement.bind(team, limit).all() : await statement.bind(limit).all();
  return json({ ok: true, items: result.results || [] }, 200, { "cache-control": "public, max-age=60" });
}

async function submitCommunity(request, env) {
  if (!sameOrigin(request)) return apiError("origin_not_allowed", 403);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return apiError("invalid_json");
  }
  if (!(await verifyTurnstile(body.turnstileToken, env, "submit_community"))) return apiError("turnstile_failed", 403);
  const url = normalizeThreadsUrl(body.url);
  if (!url) return apiError("invalid_threads_url");
  const team = String(body.team || "");
  if (!TEAM_NAMES.has(team)) return apiError("invalid_team");
  const gameTag = String(body.gameId || "").slice(0, 32);
  const existing = await env.DB.prepare(
    "SELECT id, status FROM community_submissions WHERE threads_url = ?",
  ).bind(url).first();
  if (existing) return apiError(existing.status === "approved" ? "already_published" : "already_submitted", 409);
  const embed = await threadsEmbed(url);
  if (!embed) return apiError("threads_embed_unavailable", 422);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "INSERT INTO community_submissions (threads_url, team, game_id, author_name, embed_html, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  ).bind(url, team, gameTag || null, embed.authorName, embed.html, now).run();
  return json({ ok: true, id: result.meta?.last_row_id || null, status: "pending" }, 201);
}

async function listAdminCommunity(url, env, admin) {
  const status = String(url.searchParams.get("status") || "pending");
  if (!ADMIN_STATUSES.has(status)) return apiError("invalid_status");
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50));
  const [itemsResult, countsResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, threads_url, team, game_id, author_name, embed_html, status,
              created_at, moderated_at, moderated_by
       FROM community_submissions
       WHERE status = ?
       ORDER BY CASE WHEN status = 'pending' THEN created_at ELSE moderated_at END DESC, id DESC
       LIMIT ?`,
    ).bind(status, limit).all(),
    env.DB.prepare(
      "SELECT status, COUNT(*) AS total FROM community_submissions GROUP BY status",
    ).all(),
  ]);
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of countsResult.results || []) {
    if (Object.hasOwn(counts, row.status)) counts[row.status] = Number(row.total) || 0;
  }
  return json({ ok: true, adminEmail: admin.email, status, counts, items: itemsResult.results || [] });
}

async function moderateCommunity(request, env, admin, id) {
  if (!sameOrigin(request)) return apiError("origin_not_allowed", 403);
  let body;
  try {
    body = await readJson(request);
  } catch {
    return apiError("invalid_json");
  }
  const status = String(body.status || "");
  if (!["approved", "rejected"].includes(status)) return apiError("invalid_status");
  const result = await env.DB.prepare(
    `UPDATE community_submissions
     SET status = ?, moderated_at = ?, moderated_by = ?
     WHERE id = ?`,
  ).bind(status, new Date().toISOString(), admin.email, id).run();
  if (!Number(result.meta?.changes)) return apiError("submission_not_found", 404);
  return json({ ok: true, id, status, moderatedBy: admin.email });
}

async function handleAdminApi(request, env) {
  if (!COMMUNITY_FEATURE_ENABLED) return apiError("community_coming_soon", 503);
  const admin = await verifyAdminAccess(request, env);
  if (!admin) return apiError("admin_unauthorized", 401);
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/admin/api/community") {
    return listAdminCommunity(url, env, admin);
  }
  const match = url.pathname.match(/^\/admin\/api\/community\/(\d+)$/);
  if (request.method === "PATCH" && match) {
    return moderateCommunity(request, env, admin, Number(match[1]));
  }
  return apiError("not_found", 404);
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method === "GET" && url.pathname === "/api/config") {
    return json({
      ok: true,
      environment: env.ENVIRONMENT || "unknown",
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
      writesEnabled: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.ANON_HASH_SALT),
      communityEnabled: COMMUNITY_FEATURE_ENABLED,
    });
  }
  if (request.method === "GET" && url.pathname === "/api/predictions/summary") return predictionSummary(url, env);
  if (request.method === "POST" && url.pathname === "/api/predictions") return submitPrediction(request, env);
  if (request.method === "GET" && url.pathname === "/api/series-predictions/summary") return seriesPredictionSummary(url, env);
  if (request.method === "POST" && url.pathname === "/api/series-predictions") return submitSeriesPrediction(request, env);
  if ((url.pathname === "/api/community" || url.pathname === "/api/community-submissions") && !COMMUNITY_FEATURE_ENABLED) {
    return apiError("community_coming_soon", 503);
  }
  if (request.method === "GET" && url.pathname === "/api/community") return listCommunity(url, env);
  if (request.method === "POST" && url.pathname === "/api/community-submissions") return submitCommunity(request, env);
  return apiError("not_found", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/admin/api/")) {
      try {
        return await handleAdminApi(request, env);
      } catch (error) {
        console.error("Admin API request failed", error);
        return apiError("server_error", 500);
      }
    }
    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      const admin = await verifyAdminAccess(request, env);
      if (!admin) return apiError("admin_unauthorized", 401);
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/";
      assetUrl.search = "";
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      const headers = new Headers(response.headers);
      headers.set("cache-control", "private, no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        console.error("API request failed", error);
        return apiError("server_error", 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

