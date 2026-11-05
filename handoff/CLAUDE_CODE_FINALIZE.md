# Prompt for Claude Code: finalize, commit and push

You are finishing a working-tree change set in this repo (Shazam / Arcwork, Next.js 15 + Cloudflare/Vercel, Turso/D1). Nothing is committed yet. You are on `main`. Do not push to `main`. Create the branch `hardening-and-smart-approvals` and push that.

## 1. Verify first (on the Mac, where native binaries work)
Run `npm run typecheck`, `npm test` and `npm run build`. A previous pass ran typecheck and tests in a Linux sandbox and everything passed except `tests/libsql-adapter.test.ts`, which only failed because node_modules holds macOS native binaries. It should pass here. It could not run `next build` or Electron, so build and smoke-test the desktop app (`npm run desktop`) yourself. Fix anything that breaks and tell me what.

## 2. What changed (review the diff, do not redo it)
Security
- `src/lib/crypto/session-token.ts`, `vault.ts`: removed hardcoded fallback secrets. In production they now throw if `SESSION_SECRET` / `SHAZAM_ENCRYPTION_KEY` are missing.
- `src/lib/env.ts`: seeded admin/QA accounts no longer created when `NODE_ENV=production`.
- `src/lib/auth/session.ts`: CSRF no longer trusts any `*.workers.dev` origin (loopback only outside production). A valid signed token can no longer revive a logged-out session or a suspended account when the user exists in the DB.
- `src/app/api/v1/auth/login|signup`: per-account rate limit, dummy PBKDF2 for unknown emails (timing), suspension revealed only after the password is verified, generic 500 text in production.
Routing
- `classifier.ts`: word-boundary matching (democracy no longer means OCR, dysfunction no longer means coding, transcribe outputs text).
- `router.ts`, `repo.ts` (`getRouteHealthBulk`): one health query instead of about 60; a 401 on a shared system key no longer marks the user's key invalid.
- `score-engine.ts`: health and latency now influence scoring; README formula corrected.
Co-Work
- New `src/lib/cowork/approval.ts` and migration `0016_approval_mode.sql`: approval modes ask / smart / auto (default smart). Wired through `types.ts`, `repo.ts`, `settings/route.ts`, `cowork/agent.ts`, `mcp/tools.ts`, `runs/execute.ts`, and a new `ApprovalModeCard` on the Connections page.
- `execution/system-prompt.ts`: removed the stale claim that Arcwork cannot send or schedule email; tighter answer style.
Desktop and MCP
- `desktop/bridge-core.js`, `desktop/main.js`: "Always allow here" for plain `git push` and `vercel deploy` only (`commandTrustKey`). Forced, chained or destructive commands always ask.
- `src/app/api/mcp/route.ts`: new `run_task` tool (start and wait in one call) and token-saving guidance in the instructions.
Tests added: `security-hardening`, `approval-policy`, `desktop-approval-memory`.

## 3. Deployment blockers to confirm before merging
- Production must have `SESSION_SECRET` and `SHAZAM_ENCRYPTION_KEY` set as secrets. If production has been running on the old built-in default key, `SHAZAM_ENCRYPTION_KEY` must be set to exactly that old value, otherwise every saved BYOK key becomes undecryptable. Ask me before changing it. Do not guess.
- Apply migration `0016` to Turso/D1 (`npm run db:migrate:remote` for D1; check how Turso migrations are applied).

## 4. Remaining work (do after section 1 passes, one commit each, only if build and tests stay green)
1. Replace `err: any` in catch clauses and the worst `as any` casts (about 300 `any` in `src`), starting with `src/lib/db/repo.ts`, `src/lib/runs`, `src/app/api/**`. Do not change behavior.
2. Split `src/app/page.tsx` (1540 lines) into components without changing UI or behavior. Smoke-test in the browser.
3. Compare `CRON_SECRET` with a constant-time check in `api/cron/jobs` and `api/v1/runs/resume`.
4. Add rate limits to the expensive endpoints that lack one (media, runs start, cowork). `repo.checkRateLimit` already exists.
5. Vault: derive separate keys for session signing and key encryption (HKDF with distinct labels). This needs a migration path for existing ciphertext, so write the plan and ask before doing it.
6. Chrome extension (`extensions/chrome/background.js`): the "sensitive" regex tests the model-written reason text, which causes false prompts. Consider testing only the element label and action.
7. `git rm --cached` the two tracked files under `scratch/` and delete `reports/` and `scratch/` from the working tree only if I confirm.

## 5. Commit and push
Make small logical commits in this order: security, routing, approvals (including migration and UI), desktop and MCP, tests and docs, then any section 4 work. Never commit `.env*`, `.shazam-token`, `.gstack/`, `.vercel/`, `scratch/`, screenshots or `dist-desktop`. No force pushes. Push the branch `hardening-and-smart-approvals` to `origin` and open a PR against `main` with the section 2 summary and the section 3 blockers at the top.
