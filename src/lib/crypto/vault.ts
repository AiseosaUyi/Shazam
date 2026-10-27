import { envVar, isProduction } from '@/lib/env';

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12; // 96 bits

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
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getVaultKey(): Promise<CryptoKey> {
  const hexKey = envVar('SHAZAM_ENCRYPTION_KEY');

  if (!hexKey) {
    if (isProduction()) {
      throw new Error('Refusing to encrypt: SHAZAM_ENCRYPTION_KEY secret is missing in production.');
    }
    // Deterministic dev fallback key (32 bytes)
    const devHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    return crypto.subtle.importKey(
      'raw',
      hexToUint8Array(devHex) as BufferSource,
      { name: ALGORITHM, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  let keyBytes: Uint8Array;
  if (hexKey.length === 64) {
    keyBytes = hexToUint8Array(hexKey);
  } else {
    // Hash key to 32 bytes using SHA-256
    const enc = new TextEncoder().encode(hexKey);
    const hash = await crypto.subtle.digest('SHA-256', enc);
    keyBytes = new Uint8Array(hash);
  }

  return crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a plaintext secret using AES-256-GCM via WebCrypto.
 * Format: base64(iv + cipherTextAndTag)
 */
export async function encryptSecret(plainText: string): Promise<string> {
  if (!plainText) throw new Error('Cannot encrypt empty secret');

  const key = await getVaultKey();
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

  return uint8ArrayToBase64(combined);
}

/**
 * Decrypts an encrypted payload using AES-256-GCM via WebCrypto.
 */
export async function decryptSecret(payloadBase64: string): Promise<string> {
  if (!payloadBase64) throw new Error('Cannot decrypt empty payload');

  const key = await getVaultKey();
  const combined = base64ToUint8Array(payloadBase64);

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
