# Shazam — owner setup checklist

These steps need the account owner (they accept terms, create credentials or write
secrets), so they can't be automated from the repo. Everything else is already built.

## 1. Database (required for production)

The Vercel deployment refuses to run on the old `/tmp` SQLite file, which lost all data on
cold starts. Use Turso (SQLite-compatible; migrations run automatically on first request).

1. Accept the Turso Marketplace terms:
   https://vercel.com/aiseosauyiidahorgmailcoms-projects/~/integrations/accept-terms/tursocloud?source=cli
2. Provision it on the `shazam` project:
   ```bash
   vercel integration add tursocloud/database --name shazam-db --scope aiseosauyiidahorgmailcoms-projects
   ```
   This adds `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (the app also accepts `LIBSQL_URL` / `DATABASE_URL`).
   If the integration uses different variable names, tell Claude and it will map them.

Note: old accounts lived in the ephemeral DB, so everyone signs up again once. The first
signed-up user becomes admin (or set `ADMIN_EMAILS`).

## 2. Environment variables (Production + Preview)

```bash
# 32-byte key for encrypting API keys, OAuth tokens and MCP tokens at rest
openssl rand -hex 32 | vercel env add SHAZAM_ENCRYPTION_KEY production --sensitive
# Vercel Cron sends this as a bearer token to /api/cron/jobs (sends scheduled emails)
openssl rand -hex 24 | vercel env add CRON_SECRET production --sensitive
printf "https://arcwork-ai.vercel.app" | vercel env add APP_URL production
printf "aiseosauyiidahor@gmail.com" | vercel env add ADMIN_EMAILS production
```
Repeat for `preview` if you want previews to work fully. Already connected: `BLOB_READ_WRITE_TOKEN`
(media store). The Vercel OIDC token for Sandbox + AI Gateway is automatic on deployments.

## 3. Google (Gmail + Calendar for Co-Work)

1. https://console.cloud.google.com → create project "Shazam".
2. APIs & Services → Library → enable **Gmail API** and **Google Calendar API**.
3. OAuth consent screen → External → add scopes `gmail.send`, `gmail.compose`,
   `gmail.readonly`, `calendar.events` → add yourself (and testers) as **Test users**.
   (gmail.readonly is a restricted scope: public launch needs Google verification; test
   mode works for up to 100 users.)
4. Credentials → Create OAuth client ID → Web application → Authorized redirect URI:
   `https://arcwork-ai.vercel.app/api/v1/oauth/google/callback`
   (add `http://localhost:3000/api/v1/oauth/google/callback` for local dev).
5. ```bash
   printf "<client id>"     | vercel env add GOOGLE_CLIENT_ID production
   printf "<client secret>" | vercel env add GOOGLE_CLIENT_SECRET production --sensitive
   ```
6. Shazam → Connections → **Connect Google**.

**Early access while Google reviews the app.** In testing mode Google only admits listed test users
(100 max, lifetime). Shazam therefore gates Connect Google: admins are always allowed; everyone else
clicks *Request early access* (or joins at `/waitlist`). To let someone in: Admin → Early access →
*Copy waiting emails* → paste them into Google Cloud → Auth → Audience → Test users → back in Admin,
*Mark invited*. Once Google verifies the app, set `GOOGLE_OAUTH_PUBLIC=true` to open it to everyone.
Verification needs the public `/privacy` and `/terms` pages (live) and a domain you own.

## 4. AI Gateway (free platform models)

Works on the free tier today (Qwen3 Coder Next, Kimi K2, GLM 4.6, gpt-oss-120b, FLUX.2 klein,
ElevenLabs Scribe for captions). Free-tier limits are tight (≈5 requests/min per model);
Shazam fails over between models automatically. Adding paid Gateway credits unlocks
stronger models and higher limits. Override defaults with `SHAZAM_GATEWAY_CODE_MODELS`,
`SHAZAM_GATEWAY_COWORK_MODELS`, `SHAZAM_DEFAULT_IMAGE_MODEL`, `SHAZAM_IMAGE_DAILY_LIMIT`.

## 5. Connect your Claude subscription (and Codex / Antigravity)

Shazam → Connections → **Connect Claude, Codex & Antigravity** → create a token → copy the
snippet. Claude Code:
```bash
claude mcp add --transport http shazam https://arcwork-ai.vercel.app/api/mcp \
  --header "Authorization: Bearer shz_pat_…" --scope user
```
Then: *"Use Shazam to build X. When it's done, review the files and send feedback until it's right."*
Claude.ai / Claude Desktop: Settings → Connectors → Add custom connector → URL
`https://arcwork-ai.vercel.app/api/mcp` (OAuth sign-in opens automatically).

## 6. Desktop app & browser extension

- Desktop (macOS arm64): `dist-desktop/Shazam AI-0.3.0-arm64.dmg` (unsigned: right-click →
  Open the first time). Rebuild with `npm run desktop:dist`. Pair it with a code from
  Connections → Devices, then **Add folder**. CLI alternative: `npx shazam-bridge pair CODE`,
  `shazam-bridge allow ~/code/my-app`, `shazam-bridge start`.
- Local models: install Ollama (`ollama pull qwen3.8:27b` on 32 GB, `gpt-oss:20b` on 16 GB) or
  LM Studio; the desktop app detects them automatically.
- Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `extensions/chrome`
  (or `dist-desktop/shazam-browser-bridge.zip`) → click the extension → paste a pairing code.

## 7. Deploy

```bash
git push -u origin feat/real-agents   # preview deploy via the GitHub integration
vercel deploy --prod                  # after previews pass the PRD QA protocol (§8)
```
