import { envVar } from '@/lib/env';

const SIGNING_ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };

async function getSigningKey(): Promise<CryptoKey> {
  const secret =
    envVar('SESSION_SECRET') ||
    envVar('SHAZAM_ENCRYPTION_KEY') ||
    'shazam-ai-session-key-2026-fallback-secret-production';
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  return crypto.subtle.importKey('raw', keyData, SIGNING_ALGORITHM, false, ['sign', 'verify']);
}

function base64UrlEncode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64url');
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64url').toString('utf8');
  }
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export interface SessionClaim {
  u: string; // userId
  e: string; // email
  r: string; // role
  exp: number; // expiry timestamp in seconds
  n: string; // random nonce
}

/**
 * Creates a cryptographically signed HMAC-SHA256 session token that can be validated
 * statefully (via DB lookup) or statelessly across serverless containers (Vercel Lambdas).
 */
export async function createSignedSessionToken(
  user: { id: string; email: string; role: string },
  maxAgeSeconds: number
): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const claim: SessionClaim = {
    u: user.id,
    e: user.email,
    r: user.role,
    exp,
    n: nonce,
  };

  const payloadStr = base64UrlEncode(JSON.stringify(claim));
  const key = await getSigningKey();
  const enc = new TextEncoder().encode(payloadStr);
  const signatureBytes = await crypto.subtle.sign('HMAC', key, enc);
  const signatureHex = uint8ArrayToHex(new Uint8Array(signatureBytes));

  return `${payloadStr}.${signatureHex}`;
}

/**
 * Verifies the HMAC-SHA256 signature of a session token and ensures it has not expired.
 */
export async function verifySignedSessionToken(token: string): Promise<SessionClaim | null> {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [payloadStr, signatureHex] = parts;
  try {
    const key = await getSigningKey();
    const enc = new TextEncoder().encode(payloadStr);
    const signatureBytes = hexToUint8Array(signatureHex);
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes as BufferSource, enc);
    if (!valid) {
      return null;
    }

    const json = JSON.parse(base64UrlDecode(payloadStr)) as SessionClaim;
    const now = Math.floor(Date.now() / 1000);
    if (json.exp && json.exp < now) {
      return null; // Expired
    }
    return json;
  } catch {
    return null;
  }
}
