import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Gets or derives the master 32-byte encryption key from environment.
 * If unset in development, uses a deterministic fallback key with explicit warning.
 */
export function getMasterKey(): Buffer {
  const envKey = process.env.SHAZAM_ENCRYPTION_KEY;
  if (envKey) {
    if (envKey.length === 64) {
      return Buffer.from(envKey, 'hex');
    }
    return crypto.createHash('sha256').update(envKey).digest();
  }
  // Deterministic local development key
  return crypto.createHash('sha256').update('shazam-ai-local-dev-secret-key-32b').digest();
}

/**
 * Encrypts a plaintext string (e.g. API key) using AES-256-GCM.
 * Output format: base64(iv + authTag + cipherText)
 */
export function encryptSecret(plainText: string, masterKey = getMasterKey()): string {
  if (!plainText) {
    throw new Error('Cannot encrypt empty secret');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_LENGTH });

  const cipherText = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  // Combine IV + AuthTag + CipherText
  const payload = Buffer.concat([iv, authTag, cipherText]);
  return payload.toString('base64');
}

/**
 * Decrypts a secret encrypted with encryptSecret.
 */
export function decryptSecret(encryptedPayloadBase64: string, masterKey = getMasterKey()): string {
  if (!encryptedPayloadBase64) {
    throw new Error('Cannot decrypt empty payload');
  }

  const payload = Buffer.from(encryptedPayloadBase64, 'base64');
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted payload length');
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const cipherText = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(cipherText),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

/**
 * Safely masks an API key for UI display (e.g. "sk-12345678" -> "sk-...5678").
 * Never reveals full secrets.
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) {
    return '***';
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Redacts potential secrets, keys, and authorization headers from strings and error logs.
 */
export function redactSecrets(text: string): string {
  if (!text) return '';
  return text
    // Redact Bearer tokens
    .replace(/Bearer\s+([a-zA-Z0-9_\-\.]{8,})/gi, 'Bearer [REDACTED]')
    // Redact common API key patterns (OpenAI, Anthropic, Google, DeepSeek, etc.)
    .replace(/(sk-[a-zA-Z0-9_\-]{8,})/gi, '[REDACTED_API_KEY]')
    .replace(/(AIzaSy[a-zA-Z0-9_\-]{15,})/gi, '[REDACTED_GOOGLE_KEY]')
    // Redact query param keys: api_key=..., key=...
    .replace(/(key|api_key|secret|token)=([^&\s]+)/gi, '$1=[REDACTED]');
}
