import { describe, it } from 'node:test';
import assert from 'node:assert';
import { encryptSecret, decryptSecret } from '../src/lib/crypto/vault';
import { createSignedSessionToken, verifySignedSessionToken } from '../src/lib/crypto/session-token';
import { deriveKeyBytes, HKDF_INFO_SESSION, HKDF_INFO_VAULT } from '../src/lib/crypto/hkdf';

const env = process.env as Record<string, string | undefined>;
const user = { id: 'u1', email: 'a@b.co', role: 'user' };

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = env[k];
    if (vars[k] === undefined) delete env[k];
    else env[k] = vars[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete env[k];
      else env[k] = saved[k];
    }
  }
}

const base = { SESSION_SECRET: 'test-session-secret', SHAZAM_ENCRYPTION_KEY: 'test-vault-secret' };

describe('HKDF key separation (release 1: read both, write legacy by default)', () => {
  it('same master secret yields different keys per purpose', async () => {
    const a = await deriveKeyBytes('same-secret', HKDF_INFO_SESSION);
    const b = await deriveKeyBytes('same-secret', HKDF_INFO_VAULT);
    assert.strictEqual(a.length, 32);
    assert.notDeepStrictEqual(Array.from(a), Array.from(b));
  });

  it('default writes legacy ciphertext (no v2 prefix) and round-trips', async () => {
    await withEnv({ ...base, SHAZAM_CRYPTO_V2: undefined }, async () => {
      const enc = await encryptSecret('sk-legacy-1234567890');
      assert.ok(!enc.startsWith('v2:'));
      assert.strictEqual(await decryptSecret(enc), 'sk-legacy-1234567890');
    });
  });

  it('with SHAZAM_CRYPTO_V2=1 writes v2 ciphertext and round-trips', async () => {
    await withEnv({ ...base, SHAZAM_CRYPTO_V2: '1' }, async () => {
      const enc = await encryptSecret('sk-new-1234567890');
      assert.ok(enc.startsWith('v2:'));
      assert.strictEqual(await decryptSecret(enc), 'sk-new-1234567890');
    });
  });

  it('legacy ciphertext still decrypts after v2 writing is switched on', async () => {
    const legacy = await withEnv({ ...base, SHAZAM_CRYPTO_V2: undefined }, () => encryptSecret('sk-old-1234567890'));
    await withEnv({ ...base, SHAZAM_CRYPTO_V2: '1' }, async () => {
      assert.strictEqual(await decryptSecret(legacy), 'sk-old-1234567890');
    });
  });

  it('v2 ciphertext decrypts even on a release-1 node (flag off)', async () => {
    const v2 = await withEnv({ ...base, SHAZAM_CRYPTO_V2: '1' }, () => encryptSecret('sk-mixed-1234567890'));
    await withEnv({ ...base, SHAZAM_CRYPTO_V2: undefined }, async () => {
      assert.strictEqual(await decryptSecret(v2), 'sk-mixed-1234567890');
    });
  });

  it('legacy session token verifies with flag on, and v2 token verifies with flag off', async () => {
    const legacyTok = await withEnv({ ...base, SHAZAM_CRYPTO_V2: undefined }, () => createSignedSessionToken(user, 600));
    const v2Tok = await withEnv({ ...base, SHAZAM_CRYPTO_V2: '1' }, () => createSignedSessionToken(user, 600));
    await withEnv({ ...base, SHAZAM_CRYPTO_V2: '1' }, async () => {
      assert.strictEqual((await verifySignedSessionToken(legacyTok))?.u, 'u1');
    });
    await withEnv({ ...base, SHAZAM_CRYPTO_V2: undefined }, async () => {
      assert.strictEqual((await verifySignedSessionToken(v2Tok))?.u, 'u1');
    });
  });

  it('tokens signed with a different secret are rejected', async () => {
    const tok = await withEnv({ ...base, SESSION_SECRET: 'other-secret', SHAZAM_CRYPTO_V2: '1' }, () =>
      createSignedSessionToken(user, 600)
    );
    await withEnv({ ...base, SHAZAM_CRYPTO_V2: '1' }, async () => {
      assert.strictEqual(await verifySignedSessionToken(tok), null);
    });
  });
});
