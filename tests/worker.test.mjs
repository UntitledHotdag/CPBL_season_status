import test from "node:test";
import assert from "node:assert/strict";
import taiwanSeriesGames from "../src/taiwan-series.json" with { type: "json" };
import { normalizeThreadsUrl, sanitizeThreadsEmbed, validatePrediction, verifyAdminAccess } from "../worker/index.js";

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
  assert.equal(game.testSourceGame, 341);
  assert.equal(game.dataReady, true);
  assert.equal(taiwanSeriesGames.slice(1).every((item) => item.dataReady === false), true);
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
