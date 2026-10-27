# Shazam AI handoff brief

Start from handoff/claude-foundation/. It holds the D1 schema, Cloudflare/OpenNext config, pinned package.json, security headers, shared types and the DB/env layer. Move those files into place, then build everything else on top of them.

You are taking over Shazam AI, a Next.js app in this repo. Read 04_Shazam_AI_Master_Build_Prompt.md first. It is the spec and its rules are non-negotiable. The current code looks finished but most of it is hollow or unsafe. Make it production-ready and deploy it to Cloudflare.

## What is wrong today (fix all of it)

SECURITY (fix these first)
1. POST /api/v1/agent/action runs execSync(anyCommand) on the host, passes it the full process.env, and has no auth. The blocklist is easy to get around, run_tests skips it completely, and workspaceId is not validated, so "../../" escapes the sandbox. Remove shell execution completely.
2. There is no authentication. Every route hardcodes user_default, and that user is seeded as admin.
3. The Gemini API key is sent in the URL query string, and the dev encryption key ships as a default in .env.example and docker-compose.
4. There is no input validation, no rate limiting, no CSRF check and no CSP.

FAKE OR BROKEN BACKEND
5. There is no database. Everything lives in an in-memory Map, while pg, schema.sql and Postgres in docker-compose go unused.
6. The "simulation" provider is verified_free and always eligible, so with no keys every task "succeeds" with canned text. All the tests pass only because of this.
7. Streaming is fake. POST /tasks waits for the full answer before SSE opens. There is no cancel and no stop.
8. Every model ID is stale, yet every record claims it was verified on 2026-10-27.
9. Router bugs:
   - requiredCapabilities and output modality are never checked.
   - The cost estimate ignores output tokens.
   - The monthly budget is never enforced.
   - Fallback fires on invalid_credentials and content_policy errors, and puts the route on a global cooldown for all users.
   - The Gemini free route does not flag that Google trains on free-tier data.
10. There are no conversations. Every prompt is one-shot with no history.

UI/UX
11. The mobile nav is hidden md:flex with no menu.
12. Fake status pills ("Router Active", "BYOK Mode") and a token count that falls back to a hardcoded 142.
13. "Test 429" and "Test Danger Block (rm -rf /)" buttons sit in the production UI.
14. The "Coding Agent" is four hardcoded buttons with no model in it.
15. Answers are raw text. There is no copy, retry or stop. Errors show as raw dumps. The pin dropdown shows raw route IDs.
16. The look is a generic slate and sky dark template.

## Target architecture
- Next.js 15.5.27 on Cloudflare Workers via @opennextjs/cloudflare 1.20.10, wrangler 4.149.0, nodejs_compat. Delete the Dockerfile, docker-compose and pg.
- D1 is the only database, using migrations/0001_init.sql from the foundation. Every query must filter by user_id. Tests run on node:sqlite behind the same D1-shaped interface.
- Use WebCrypto everywhere:
  - Passwords: PBKDF2-SHA256 with 100k iterations.
  - BYOK vault: AES-256-GCM using the SHAZAM_ENCRYPTION_KEY secret.
  - In production, refuse to encrypt if the secret is missing.
- Auth: email and password, httpOnly Secure SameSite=Lax session cookie (store a SHA-256 of the token), and an Origin check on every mutating request. The first user and anyone in ADMIN_EMAILS becomes admin. Enforce admin role on the server.
- Validate every API body with zod. Rate-limit auth by IP and tasks by user in D1. Send CSP and security headers.
- System env keys are for admins only, unless SHAZAM_SHARE_SYSTEM_KEYS=true. Default is BYOK.
- The simulation provider runs only when SHAZAM_ENABLE_SIMULATION=true and is labelled "Demo".

## Catalogue (verified from official pages on 2026-10-27; store source URL and date for each)
- Google (send x-goog-api-key as a header)
  - gemini-3.8-flash: free tier, but data is used to improve products. Paid $0.75 / $3.75 per 1M through Dec 31 2026.
  - gemini-3.5-flash-lite: free tier. Paid $0.30 / $2.50.
  - gemini-4-argon: paid only. $2 / $10 through Nov 30 2026, then $4 / $20. 1M context.
- OpenAI (chat completions works)
  - gpt-6.1-terra: $1 / $5, 1.05M context, 128k max output.
  - gpt-6-luna: $0.10 / $0.50.
  - gpt-6.1-sol: $2 / $10.
  - gpt-6-astra: $10 / $50. Keep it disabled until account access is confirmed.
- Anthropic (1M context, 128k output)
  - claude-sonnet-5-5: $2 / $10.
  - claude-opus-5-5: $4 / $20.
  - claude-haiku-5-5: pricing is only "from", so set cost_class unknown.
- DeepSeek
  - deepseek-flash and deepseek-v4-pro: the price was not verifiable, so set cost_class unknown.
- OpenRouter
  - Do NOT hardcode free slugs. Sync them live from https://openrouter.ai/api/v1/models and cache in D1.
  - A model counts as verified_free only if its id ends in :free and both prompt and completion price are 0.
  - Mark training as "unknown".
- Alibaba Qwen and Hugging Face: keep these as unverified and disabled.
- Where context or limits were not stated, store null instead of guessing. Replace the fake quality scores with a documented 1 to 5 internal prior, labelled "prior" in traces.

## Router rules
- Unknown-cost routes are usable only when manually pinned. Free-only accepts only verified_free.
- Estimate cost from input plus expected output tokens. Block a route if the estimate is over the per-task cap or would push the monthly spend over budget.
- Check modality, capability and context. In strict privacy mode, exclude routes where training is true or unknown.
- Fallback rules:
  - Fall back only on retryable errors (rate_limited, model_unavailable, timeout, 5xx), plus quota_exhausted and invalid_credentials, which may move to a different provider.
  - content_policy stops the task with no fallback.
  - Never fall back from free to paid. Paid to paid only when allow_paid_fallback is on.
  - A pinned route never switches.
  - Respect Retry-After. Cooldown is user-scoped when the user's own key failed, global otherwise. A 401 marks the credential invalid.
  - Run eligibility checks again before every fallback.
- Persist the decision trace, attempts and usage ledger with cost_kind (estimated, unknown or zero) and tokens_kind (provider_reported or estimated).

## Execution
- POST /api/v1/tasks returns a single SSE stream with these events: task_created, route_selected, delta, reasoning, fallback, done, error. Send full conversation history.
- Client abort cancels the provider fetch. Add POST /api/v1/tasks/:id/cancel. GET /tasks/:id/events replays a finished task.
- Adapters: one OpenAI-compatible adapter (OpenAI, DeepSeek with reasoning_content, OpenRouter with reasoning), Anthropic Messages, and Gemini streamGenerateContent. Normalize errors and never leak keys or stack traces.

## Coding agent (honest version)
- Per-user files live in D1. The model returns JSON file changes.
- A policy engine checks them: path allowlist, no "..", size limits, no secrets files.
- The user sees the diff and clicks Apply or Reject. Add checkpoints and restore.
- No shell execution. Show the message "Running code needs an isolated container, not available in this deployment".

## UI/UX
- Pages: /login, /signup, onboarding (connect a first key), / (chat), /models, /connections, /usage, /settings, /admin, /agent.
- Chat page:
  - A conversation sidebar.
  - Policy selector and task-type override.
  - Pin by model name, not route ID.
  - Streamed markdown with code blocks and a copy button.
  - Stop, retry, copy, and thumbs up or down feedback.
  - A route disclosure drawer showing provider, exact model ID, policy, rationale, cost class, estimated cost, quota confidence, and fallback history.
- Errors are one human sentence plus a fix action.
- Mobile works at 375px with a real menu. Keyboard accessible with visible focus.
- No fake badges, pills or numbers. Unknown values read "unknown". Empty, loading and error states everywhere.
- Give it a distinctive visual identity, not the default slate and sky gradient template.

## Tests (node:test + tsx on node:sqlite)
Write tests for each of these:
- Free-only never selects or falls back to paid or unknown.
- A pin never switches.
- Over-cap and over-budget routes are blocked.
- content_policy produces no fallback.
- 401 marks the key invalid.
- 429 with Retry-After sets a cooldown.
- Tenant isolation: user B cannot read A's tasks, credentials or files.
- A non-admin cannot reach admin APIs.
- The vault round-trips and keys never appear in responses.
- The agent policy rejects traversal.
- Classifier basics.

`npm run typecheck`, `npm test` and `npx opennextjs-cloudflare build` must all pass.

## Deploy
1. Run `npx wrangler login`.
2. Run `npx wrangler d1 create shazam-db` and put the id in wrangler.jsonc.
3. Run `npx wrangler d1 migrations apply shazam-db --remote`.
4. Run `npx wrangler secret put SHAZAM_ENCRYPTION_KEY`, using a random 32-byte hex value.
5. Run `npx wrangler secret put ADMIN_EMAILS` and set it to aiseosauyiidahor@gmail.com.
6. Run `npm run deploy`.
7. Smoke-test the live URL: sign up, connect a key, ask a task, check the route disclosure, check the usage ledger.

Rewrite the README and the docs/ files honestly, including known limitations. Finish with a report covering files changed, tests and results, verified providers, limitations, and next steps. Work milestone by milestone and do not stop at a plan.
