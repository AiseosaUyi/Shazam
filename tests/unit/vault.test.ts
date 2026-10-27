import { describe, it } from 'node:test';
import assert from 'node:assert';
import { decryptSecret, encryptSecret, maskApiKey, redactSecrets } from '@/lib/crypto/vault';

describe('BYOK Vault & Encryption Unit Tests', () => {
  it('encrypts and decrypts secrets with AES-256-GCM', () => {
    const rawKey = 'sk-proj-test1234567890abcdef-secret-token';
    const encrypted = encryptSecret(rawKey);

    assert.notStrictEqual(encrypted, rawKey);
    assert.ok(encrypted.length > 32);

    const decrypted = decryptSecret(encrypted);
    assert.strictEqual(decrypted, rawKey);
  });

  it('generates distinct ciphertexts for identical plaintext due to random IVs', () => {
    const rawKey = 'sk-ant-api03-abcdef123456';
    const enc1 = encryptSecret(rawKey);
    const enc2 = encryptSecret(rawKey);

    assert.notStrictEqual(enc1, enc2);
    assert.strictEqual(decryptSecret(enc1), rawKey);
    assert.strictEqual(decryptSecret(enc2), rawKey);
  });

  it('throws error when attempting to decrypt tampered payload', () => {
    const rawKey = 'test-secret';
    const enc = encryptSecret(rawKey);
    const tampered = enc.slice(0, -4) + 'AAAA';

    assert.throws(() => {
      decryptSecret(tampered);
    });
  });

  it('masks API keys safely without exposing full tokens', () => {
    assert.strictEqual(maskApiKey('sk-1234567890abcdef'), 'sk-...cdef');
    assert.strictEqual(maskApiKey('short'), '***');
    assert.strictEqual(maskApiKey(''), '');
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
