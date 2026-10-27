const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Hashes a plaintext password using PBKDF2-SHA256 (100,000 iterations).
 * Stored format: pbkdf2:100000:<saltHex>:<hashHex>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const pwBytes = new TextEncoder().encode(password);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    pwBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    KEY_BYTES * 8
  );

  const hashHex = uint8ArrayToHex(new Uint8Array(derivedBits));
  const saltHex = uint8ArrayToHex(salt);

  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verifies a password against the stored PBKDF2 hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    return false;
  }

  const iterations = parseInt(parts[1], 10);
  const salt = hexToUint8Array(parts[2]);
  const expectedHashHex = parts[3];

  const pwBytes = new TextEncoder().encode(password);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    pwBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    KEY_BYTES * 8
  );

  const derivedHex = uint8ArrayToHex(new Uint8Array(derivedBits));
  return derivedHex === expectedHashHex;
}

/**
 * Generates a high-entropy session token.
 */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return uint8ArrayToHex(bytes);
}

/**
 * Hashes a session token with SHA-256 for database storage.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return uint8ArrayToHex(new Uint8Array(hashBuffer));
}
