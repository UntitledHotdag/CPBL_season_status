import test from "node:test";
import assert from "node:assert/strict";
import taiwanSeriesGames from "../src/taiwan-series.json" with { type: "json" };
import taiwanSeriesRosters from "../src/taiwan-series-rosters.json" with { type: "json" };
import worker, { normalizeThreadsUrl, predictionWindowOpen, sanitizeThreadsEmbed, validatePrediction, validateSeriesPrediction, verifyAdminAccess } from "../worker/index.js";

const game = taiwanSeriesGames[0];

test("2026 Taiwan Series schedule contains G1-G7 in order", () => {
  assert.deepEqual(
    taiwanSeriesGames.map(({ g, date, time, away, home }) => ({ g, date, time, away, home })),
    [
      { g: 1, date: "2026-10-17", time: "17:05", away: "中信兄弟", home: "味全龍" },
      { g: 2, date: "2026-10-18", time: "17:05", away: "中信兄弟", home: "味全龍" },
      { g: 3, date: "2026-10-20", time: "18:35", away: "味全龍", home: "中信兄弟" },
      { g: 4, date: "2026-10-21", time: "18:35", away: "味全龍", home: "中信兄弟" },
      { g: 5, date: "2026-10-23", time: "18:35", away: "中信兄弟", home: "味全龍" },
      { g: 6, date: "2026-10-24", time: "17:05", away: "中信兄弟", home: "味全龍" },
      { g: 7, date: "2026-10-25", time: "17:05", away: "中信兄弟", home: "味全龍" },
    ],
  );
  assert.equal(taiwanSeriesGames.every((item) => typeof item.dataReady === "boolean"), true);
  assert.equal(taiwanSeriesGames.every((item) => !item.demo && !item.testSourceGame), true);
});

test("settled games carry a final result and stop accepting predictions", () => {
  for (const item of taiwanSeriesGames.filter((g) => g.dataReady)) {
    assert.notEqual(item.awayScore, item.homeScore);
    assert.ok(item.decisions?.win && item.decisions?.loss && item.mvp?.name && item.winningRbi);
    assert.equal(predictionWindowOpen(item, {}, new Date(Date.parse(item.startsAt) - 3600e3)), false);
  }
});

test("each game accepts predictions until its own first pitch", () => {
  const scheduled = { ...game, dataReady: false };
  assert.equal(predictionWindowOpen(scheduled, {}, new Date("2026-10-17T17:04:59+08:00")), true);
  assert.equal(predictionWindowOpen(scheduled, {}, new Date("2026-10-17T17:05:00+08:00")), false);
  assert.equal(predictionWindowOpen({ ...game, dataReady: true }, {}, new Date("2026-10-17T16:00:00+08:00")), false);
});

test("Taiwan Series rosters contain 32 unique players per team", () => {
  assert.equal(taiwanSeriesRosters.year, 2026);
  for (const roster of Object.values(taiwanSeriesRosters.teams)) {
    assert.equal(roster.pitchers.length, 15);
    assert.equal(roster.catchers.length, 3);
    assert.equal(roster.infielders.length, 8);
    assert.equal(roster.outfielders.length, 6);
    const names = [...roster.pitchers, ...roster.catchers, ...roster.infielders, ...roster.outfielders];
    assert.equal(new Set(names).size, 32);
  }
});

test("prediction validation accepts players from the official Taiwan Series roster", () => {
  const result = validatePrediction(game, {
    awayScore: 5,
    homeScore: 2,
    rbi: "陳俊秀",
    win: "勝騎士",
    loss: "鋼龍",
    mvp: "菲力士",
  });
  assert.equal(result.value.winnerTeam, "中信兄弟");
});

test("prediction candidates must come from the correct teams", () => {
  const result = validatePrediction(game, {
    awayScore: 3,
    homeScore: 2,
    rbi: "岳東華",
    win: "呂彥青",
    loss: "林凱威",
    mvp: "岳東華",
  });
  assert.equal(result.value.winnerTeam, "中信兄弟");
});

test("winner-side validation rejects a losing-team MVP", () => {
  const result = validatePrediction(game, {
    awayScore: 3,
    homeScore: 2,
    rbi: "岳東華",
    win: "呂彥青",
    loss: "林凱威",
    mvp: "郭天信",
  });
  assert.equal(result.error, "mvp_must_be_winner");
});

test("winning and losing pitcher roles cannot be swapped", () => {
  const wrongWinner = validatePrediction(game, {
    awayScore: 3,
    homeScore: 2,
    rbi: "岳東華",
    win: "林凱威",
    loss: "林凱威",
    mvp: "岳東華",
  });
  assert.equal(wrongWinner.error, "winning_pitcher_must_be_winner");

  const wrongLoser = validatePrediction(game, {
    awayScore: 3,
    homeScore: 2,
    rbi: "岳東華",
    win: "呂彥青",
    loss: "呂彥青",
    mvp: "岳東華",
  });
  assert.equal(wrongLoser.error, "losing_pitcher_must_be_loser");
});

test("home-team predictions reverse the candidate sides", () => {
  const result = validatePrediction(game, {
    awayScore: 1,
    homeScore: 2,
    rbi: "張政禹",
    win: "梅賽鍶",
    loss: "呂彥青",
    mvp: "梅賽鍶",
  });
  assert.equal(result.value.winnerTeam, "味全龍");
});

test("Taiwan Series predictions cannot be tied", () => {
  const result = validatePrediction(game, {
    awayScore: 2,
    homeScore: 2,
    rbi: "岳東華",
    win: "呂彥青",
    loss: "林凱威",
    mvp: "岳東華",
  });
  assert.equal(result.error, "tie_not_allowed");
});

test("series score validation accepts only best-of-seven final scores", () => {
  assert.deepEqual(validateSeriesPrediction({ brothersWins: 4, dragonsWins: 2 }).value, { brothersWins: 4, dragonsWins: 2 });
  assert.deepEqual(validateSeriesPrediction({ brothersWins: 3, dragonsWins: 4 }).value, { brothersWins: 3, dragonsWins: 4 });
  assert.equal(validateSeriesPrediction({ brothersWins: 3, dragonsWins: 2 }).error, "invalid_series_score");
  assert.equal(validateSeriesPrediction({ brothersWins: 4, dragonsWins: 4 }).error, "invalid_series_score");
});

test("Threads URLs are normalized and unrelated hosts are rejected", () => {
  assert.equal(
    normalizeThreadsUrl("https://threads.net/@fan/post/ABC_123?x=1"),
    "https://www.threads.com/@fan/post/ABC_123/",
  );
  assert.equal(normalizeThreadsUrl("https://example.com/@fan/post/ABC_123"), null);
});

test("Threads embed HTML drops scripts and rejects event handlers", () => {
  const clean = sanitizeThreadsEmbed('<blockquote class="text-post-media"><a href="https://www.threads.com/t/ABC/">post</a></blockquote><script src="https://www.threads.com/embed.js"></script>');
  assert.equal(clean, '<blockquote class="text-post-media"><a href="https://www.threads.com/t/ABC/">post</a></blockquote>');
  assert.equal(sanitizeThreadsEmbed('<blockquote class="text-post-media" onclick="alert(1)"></blockquote>'), null);
});

test("community reads and submissions stay disabled while the feature is coming soon", async () => {
  for (const request of [
    new Request("https://staging.mybaseballgame.com/api/community"),
    new Request("https://staging.mybaseballgame.com/api/community-submissions", { method: "POST" }),
    new Request("https://staging.mybaseballgame.com/admin/api/community"),
  ]) {
    const response = await worker.fetch(request, {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "community_coming_soon");
  }
  const config = await worker.fetch(new Request("https://staging.mybaseballgame.com/api/config"), {});
  assert.equal((await config.json()).communityEnabled, false);
});

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

test("admin access verifies the Cloudflare Access signature, audience, and email", async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = "admin-test-key";
  publicJwk.alg = "RS256";
  const now = Date.now();
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: publicJwk.kid }));
  const payload = base64Url(JSON.stringify({
    aud: ["admin-audience"],
    email: "jjwer210184@gmail.com",
    iss: "https://cpbl-admin-test.cloudflareaccess.com",
    exp: Math.floor(now / 1000) + 300,
  }));
  const signed = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(signed));
  const token = `${signed}.${base64Url(signature)}`;
  const request = new Request("https://staging.mybaseballgame.com/admin/api/community", {
    headers: { "cf-access-jwt-assertion": token },
  });
  const env = {
    ADMIN_EMAILS: "jjwer210184@gmail.com",
    ACCESS_TEAM_DOMAIN: "https://cpbl-admin-test.cloudflareaccess.com",
    ACCESS_AUD: "admin-audience",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    assert.deepEqual(await verifyAdminAccess(request, env, now), { email: "jjwer210184@gmail.com" });
    assert.equal(await verifyAdminAccess(request, { ...env, ADMIN_EMAILS: "someone@example.com" }, now), null);
    assert.equal(await verifyAdminAccess(request, { ...env, ACCESS_AUD: "wrong-audience" }, now), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
