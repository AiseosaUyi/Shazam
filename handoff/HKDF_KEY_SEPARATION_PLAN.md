# Plan: separate keys for session signing and BYOK encryption (HKDF)

## Problem
- `session-token.ts` signs with `SESSION_SECRET || SHAZAM_ENCRYPTION_KEY`, used raw as the HMAC key.
- `vault.ts` encrypts with `SHAZAM_ENCRYPTION_KEY || SESSION_SECRET` (SHA-256 of it, or raw hex if 64 chars).
- If only one env var is set, the same bytes both sign sessions and encrypt stored provider keys. One leak or one cryptographic misuse breaks both.

## Target
Derive two independent keys from a master secret with HKDF-SHA-256 and distinct `info` labels:
- `shazam/session-sign/v1` for HMAC signing
- `shazam/vault-encrypt/v1` for AES-GCM

## Existing-data constraints
- Ciphertext format today: `base64(iv + ciphertext+tag)`, no version marker. Old rows must stay decryptable.
- Existing sessions are signed with the raw key. Invalidating them only logs users out once (acceptable, but avoidable).

## Migration path (no downtime, no data migration job required)
1. **Versioned ciphertext.** New writes are prefixed `v2:` + base64(...). Decrypt: if it starts with `v2:` use the HKDF key; otherwise use the legacy key. No schema change.
2. **Lazy re-encrypt.** On each successful legacy decrypt, re-encrypt with v2 and write back (inside the existing read path in `repo.ts`). Optional one-off script `scripts/reencrypt-vault.mjs` to finish the long tail, then remove the legacy branch in a later release.
3. **Session tokens.** Sign with the derived key. Verify accepts the derived key first, then the legacy raw key for a fixed window (for example 30 days, matching max token lifetime). After that, delete the legacy verify path.
4. **Env.** No new variables required. Recommended: set distinct `SESSION_SECRET` and `SHAZAM_ENCRYPTION_KEY`. HKDF still separates the keys if they are equal, but distinct values are better hygiene.

## Tests
- v2 round trip; legacy ciphertext still decrypts; legacy token still verifies; new token fails verification under the legacy-only path; same master secret yields different session and vault keys.

## Risks
- Rollback after step 1 leaves `v2:` rows unreadable by old code. Ship the decrypt-both release first, then flip writes to v2 in a second release.
- Do not change `SHAZAM_ENCRYPTION_KEY` itself as part of this (see PR #2 blocker about the old default key).

## Decision needed
Approve the two-release rollout above (release 1: read both, write legacy; release 2: write v2). This is security-sensitive, so it should be implemented by our model, not Arcwork.
