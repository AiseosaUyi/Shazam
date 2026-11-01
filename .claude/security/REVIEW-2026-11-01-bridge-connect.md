# Security review: bridge browser connect + on-demand folder consent (2026-11-01)

Scope: `src/lib/bridge/device-auth.ts`, `src/app/api/v1/bridge/device/{start,token,approve}`, `src/app/connect/page.tsx`,
`src/lib/bridge/folders.ts`, `desktop/bridge-core.js` (deviceAuth, checkConsentFolder, request_folder), `desktop/main.js`, `cli/bridge.js`.

## Summary
No Critical/High findings. One Low fixed during review. Two accepted residual risks inherent to device-code flows.

## Controls in place
- Device code: 32 random bytes, SHA-256 at rest, single use (atomic `UPDATE … RETURNING` claim; race test). User code: 8 chars / 27-letter alphabet, hashed, 10-minute TTL.
- Approve: signed-in session required; POST requires an `Origin` header matching the host (stricter than `verifyCsrfOrigin`, which lets origin-less requests through); lookups + decisions rate-limited 30 / 10 min per user (code guessing). Device binds to the *approver's* user id (tenant isolation; test asserts).
- Start: 20 / 10 min per IP; token polling: 60 / min per IP plus RFC 8628 `slow_down`.
- `/connect` cannot be framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'` in next.config.mjs): no clickjacked Approve.
- Folder consent: native prompt, default button "Don't allow"; realpath'd; refuses `/`, home, system and credential folders; declines remembered 10 min per folder; background CLI uses osascript with text passed as argv (no AppleScript injection) and denies when no native prompt exists (Windows). Risky-command confirmation unchanged.
- `arcwork://` deep links only open the window / start a browser sign-in; they never grant a folder or approve anything.

## Findings
- **L1 (fixed)** — approved-but-uncollected requests stayed redeemable until cleanup (~24h). `poll()` now expires any request past `expires_at`.
- **R1 (accepted, Medium)** — device-code phishing: an attacker can send a victim a `/connect?code=` link for the attacker's machine; approving binds that machine to the victim's account (it would receive the victim's local-folder task prompts). Mitigations: page warns "never approve a code someone sent you", shows the device name/platform and a different-network warning (requester vs approver IP hash). Same risk class as the existing pairing code.
- **R2 (accepted, Low)** — the lookup reveals a pending request's device name/platform to any signed-in user holding the code (rate-limited, 10-minute window).

## Not covered
Electron packaging/signing, auto-update, the companion daemon in `cli/index.js`, the browser extension pairing path.
