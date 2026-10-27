import { describe, it } from 'node:test';
import assert from 'node:assert';
import { encryptSecret, decryptSecret, maskKey, redactSecrets } from '@/lib/crypto/vault';

describe('WebCrypto AES-256-GCM Vault Tests', () => {
  it('encrypts and decrypts secrets with AES-256-GCM', async () => {
    const rawKey = 'sk-proj-test1234567890abcdef-secret-token';
    const encrypted = await encryptSecret(rawKey);

    assert.notStrictEqual(encrypted, rawKey);
    assert.ok(encrypted.length > 32);

    const decrypted = await decryptSecret(encrypted);
    assert.strictEqual(decrypted, rawKey);
  });

  it('generates distinct ciphertexts for identical plaintext due to random 12-byte IVs', async () => {
    const rawKey = 'sk-ant-api03-abcdef123456';
    const enc1 = await encryptSecret(rawKey);
    const enc2 = await encryptSecret(rawKey);

    assert.notStrictEqual(enc1, enc2);
    assert.strictEqual(await decryptSecret(enc1), rawKey);
    assert.strictEqual(await decryptSecret(enc2), rawKey);
  });

  it('throws error when attempting to decrypt tampered payload', async () => {
    const rawKey = 'test-secret';
    const enc = await encryptSecret(rawKey);
    const tampered = enc.slice(0, -4) + 'AAAA';

    await assert.rejects(async () => {
      await decryptSecret(tampered);
    });
  });

  it('masks API keys safely without exposing full tokens', () => {
    assert.strictEqual(maskKey('sk-1234567890abcdef'), 'sk-...cdef');
    assert.strictEqual(maskKey('short'), '***');
    assert.strictEqual(maskKey(''), '');
  });

  it('redacts sensitive credentials from strings and error messages', () => {
    const rawLog = 'Request failed with Authorization: Bearer sk-1234567890abcdef and key=AIzaSyAbcd1234567890';
    const redacted = redactSecrets(rawLog);

    assert.ok(!redacted.includes('sk-1234567890abcdef'));
    assert.ok(!redacted.includes('AIzaSyAbcd1234567890'));
    assert.ok(redacted.includes('Bearer [REDACTED]'));
    assert.ok(redacted.includes('key=[REDACTED]'));
  });
});
