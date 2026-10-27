import { describe, it } from 'node:test';
import assert from 'node:assert';
import { db } from '@/lib/db';
import { encryptSecret, maskApiKey } from '@/lib/crypto/vault';

describe('Security: Credential Vault & Tenant Isolation', () => {
  it('stores keys encrypted at rest without plaintext leakage', async () => {
    const rawKey = 'sk-live-super-secret-production-key-12345';
    const encrypted = encryptSecret(rawKey);
    const keyPrefix = maskApiKey(rawKey);

    const cred = await db.saveCredential({
      id: 'cred_test_1',
      userId: 'user_alice',
      providerId: 'openai',
      encryptedKey: encrypted,
      keyPrefix,
      keyVersion: 1,
      status: 'valid',
      createdAt: new Date().toISOString(),
    });

    // Verify stored entity
    assert.notStrictEqual(cred.encryptedKey, rawKey);
    assert.ok(!cred.encryptedKey.includes(rawKey));
    assert.strictEqual(cred.keyPrefix, 'sk-...2345');
    assert.strictEqual((cred as any).rawKey, undefined);
  });

  it('enforces strict tenant isolation across user credentials', async () => {
    // User Alice creates key
    await db.saveCredential({
      id: 'user_alice:deepseek',
      userId: 'user_alice',
      providerId: 'deepseek',
      encryptedKey: encryptSecret('sk-alice-deepseek-key'),
      keyPrefix: 'sk-...alice',
      keyVersion: 1,
      status: 'valid',
      createdAt: new Date().toISOString(),
    });

    // User Bob attempts to access credentials
    const bobCreds = await db.getCredentialsForUser('user_bob');
    assert.strictEqual(bobCreds.length, 0);

    const bobSpecific = await db.getCredential('user_bob', 'deepseek');
    assert.strictEqual(bobSpecific, null);
  });
});
