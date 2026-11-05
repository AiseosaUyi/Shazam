import { envVar, isProduction } from '@/lib/env';
import { HKDF_INFO_VAULT, deriveKeyBytes, writeV2Keys } from '@/lib/crypto/hkdf';

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12; // 96 bits
const V2_PREFIX = 'v2:';

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  let clean = base64.trim();
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.slice(1, -1);
  }
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // ignore
  }
  // Convert URL-safe base64 to standard base64 and recover spaces converted from +
  clean = clean.replace(/-/g, '+').replace(/_/g, '/').replace(/ /g, '+');
  while (clean.length % 4 !== 0) {
    clean += '=';
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getMasterSecret(): string {
  const configuredKey = envVar('SHAZAM_ENCRYPTION_KEY') || envVar('SESSION_SECRET');
  if (!configuredKey && isProduction()) {
    // A key that lives in the repo makes every stored BYOK secret readable by anyone with the source.
    throw new Error('SHAZAM_ENCRYPTION_KEY is not configured. Set it as a secret before storing provider keys.');
  }
  return configuredKey || 'shazam-dev-only-vault-key-not-for-production';
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: ALGORITHM, length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** v2 key: HKDF-derived, independent from the session-signing key. */
async function getVaultKeyV2(): Promise<CryptoKey> {
  return importAesKey(await deriveKeyBytes(getMasterSecret(), HKDF_INFO_VAULT));
}

/** Legacy key: the configured secret used directly (hex) or hashed with SHA-256. Kept so old ciphertext stays readable. */
async function getVaultKey(): Promise<CryptoKey> {
  const rawKey = getMasterSecret();

  let keyBytes: Uint8Array;
  if (rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)) {
    keyBytes = hexToUint8Array(rawKey);
  } else {
    // Hash key to 32 bytes using SHA-256
    const enc = new TextEncoder().encode(rawKey);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    keyBytes = new Uint8Array(hash);
  }

  return importAesKey(keyBytes);
}

/**
 * Encrypts a plaintext secret using AES-256-GCM via WebCrypto.
 * Format: base64(iv + cipherTextAndTag)
 */
export async function encryptSecret(plainText: string): Promise<string> {
  if (!plainText) throw new Error('Cannot encrypt empty secret');

  const v2 = writeV2Keys();
  const key = v2 ? await getVaultKeyV2() : await getVaultKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plainText);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as BufferSource },
    key,
    encoded as BufferSource
  );

  const cipherBytes = new Uint8Array(cipherBuffer);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);

  const b64 = uint8ArrayToBase64(combined);
  return v2 ? V2_PREFIX + b64 : b64;
}

/**
 * Decrypts an encrypted payload using AES-256-GCM via WebCrypto.
 */
export async function decryptSecret(payloadBase64: string): Promise<string> {
  if (!payloadBase64) throw new Error('Cannot decrypt empty payload');

  const isV2 = payloadBase64.startsWith(V2_PREFIX);
  const key = isV2 ? await getVaultKeyV2() : await getVaultKey();
  const combined = base64ToUint8Array(isV2 ? payloadBase64.slice(V2_PREFIX.length) : payloadBase64);

  if (combined.length <= IV_LENGTH) {
    throw new Error('Invalid encrypted payload length');
  }

  const iv = combined.slice(0, IV_LENGTH);
  const cipherBytes = combined.slice(IV_LENGTH);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as BufferSource },
    key,
    cipherBytes as BufferSource
  );

  return new TextDecoder().decode(decryptedBuffer);
}

/**
 * Masks an API key for UI display (e.g., "sk-...4a2b").
 */
export function maskKey(key: string): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '***';
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Redacts API keys, Bearer tokens, and secrets from text logs and errors.
 */
export function redactSecrets(text: string): string {
  if (!text) return '';
  return text
    .replace(/Bearer\s+([a-zA-Z0-9_\-\.]{8,})/gi, 'Bearer [REDACTED]')
    .replace(/(sk-[a-zA-Z0-9_\-]{8,})/gi, '[REDACTED_API_KEY]')
    .replace(/(AIzaSy[a-zA-Z0-9_\-]{15,})/gi, '[REDACTED_GOOGLE_KEY]')
    .replace(/(key|api_key|secret|token)=([^&\s]+)/gi, '$1=[REDACTED]');
}
