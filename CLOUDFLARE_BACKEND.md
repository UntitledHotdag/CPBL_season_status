# Cloudflare backend setup

The site remains static for normal page requests. Only `/api/*` and the protected `/admin*` paths run through the Worker. D1 stores anonymous Taiwan Series game and final-score predictions. Community storage remains disabled; user names and photos are never uploaded.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
# Replace ANON_HASH_SALT in .dev.vars with a long random value.
npm run db:migrate:local
npm run dev
```

The local Turnstile keys are Cloudflare's test keys. They must never be used for staging or production.

## One-time staging setup

1. Sign in with `npx wrangler login`.
2. Create the database:

   ```bash
   npx wrangler d1 create cpbl-season-status-staging
   ```

3. Replace the staging placeholder `database_id` in `wrangler.jsonc` with the returned ID.
4. In Cloudflare Turnstile, create a widget for `staging.mybaseballgame.com`.
5. Configure the public site key and both server secrets. Wrangler prompts for values without putting them in shell history:

   ```bash
   npx wrangler secret put TURNSTILE_SITE_KEY
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler secret put ANON_HASH_SALT
   ```

6. Create a Cloudflare Access self-hosted application for `staging.mybaseballgame.com/admin*`. Add an Allow policy whose Emails rule contains only the administrator's email address, and use One-time PIN as the login method.
7. Copy the Access team domain and the application's Audience (AUD) tag, then configure the admin values as Worker secrets:

   ```bash
   npx wrangler secret put ADMIN_EMAILS
   npx wrangler secret put ACCESS_TEAM_DOMAIN
   npx wrangler secret put ACCESS_AUD
   ```

8. Apply the schema and deploy:

   ```bash
   npm run deploy:staging
   ```

For the Cloudflare Git-connected staging project, use `npm run build` as the build command and `npm run db:migrate:staging && npx wrangler deploy` as the deploy command after the database ID and secrets are configured.

## One-time production setup

Repeat the setup with database name `cpbl-season-status`, a Turnstile widget that allows `mybaseballgame.com` and `www.mybaseballgame.com`, and production-scoped secrets:

```bash
npx wrangler secret put TURNSTILE_SITE_KEY --env production
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
npx wrangler secret put ANON_HASH_SALT --env production
npm run deploy:production
```

Replace the production placeholder `database_id` in `wrangler.jsonc` before deploying. Every Taiwan Series game must include `startsAt`; its prediction window closes exactly at that time. The whole-series prediction closes at G1's `startsAt`.

## Community moderation

New submissions use `status = 'pending'` and never appear publicly until approved. Open `https://staging.mybaseballgame.com/admin` and sign in through Cloudflare Access with the allowed administrator email. The dashboard can approve, reject, take down, or re-approve submissions, and records which Access identity handled the item.

The Worker verifies the Access JWT itself, including its signature, issuer, audience, expiry, and email allowlist. Protect `/admin*`, not only `/admin`, so the page and `/admin/api/*` share the same Access policy. Do not expose `ADMIN_TEST_MODE` outside local development.

The D1 console remains a fallback:

```sql
SELECT id, threads_url, team, game_id, created_at
FROM community_submissions
WHERE status = 'pending'
ORDER BY created_at;

UPDATE community_submissions
SET status = 'approved', moderated_at = CURRENT_TIMESTAMP,
    moderated_by = 'manual-console'
WHERE id = 123;

UPDATE community_submissions
SET status = 'rejected', moderated_at = CURRENT_TIMESTAMP,
    moderated_by = 'manual-console'
WHERE id = 123;
```

Only approve public Threads posts that visibly use this site's fan-made card format. Reject advertisements, impersonation, harassment, official-logo misuse, or unrelated posts. If a creator asks for removal, change the row to `rejected`; do not delete it unless deletion is specifically required.

## Data boundaries

- Stored game-prediction fields: game, predicted score, predicted winner and selected player names, anonymous browser ID hash, timestamps.
- Stored series-prediction fields: final wins for both teams, anonymous browser ID hash, timestamps.
- The community tables and moderation code remain present but all public, submission, and admin APIs return `503 community_coming_soon` while the feature is paused.
- Never store the fan's display name, uploaded photo, raw anonymous browser ID, or IP address.
- GA events may record only the team letter and game number; never send player names or Threads URLs to GA.

