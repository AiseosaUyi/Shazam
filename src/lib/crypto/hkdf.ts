import { envVar } from '@/lib/env';

/** Distinct labels so one master secret yields independent keys per purpose. */
export const HKDF_INFO_SESSION = 'shazam/session-sign/v1';
export const HKDF_INFO_VAULT = 'shazam/vault-encrypt/v1';

const HKDF_SALT = new TextEncoder().encode('shazam-hkdf-salt-v1');

/**
 * Two-release rollout (see handoff/HKDF_KEY_SEPARATION_PLAN.md).
 * Release 1 (default): every deployment can READ both formats, but still WRITES the legacy one,
 * so a rollback never strands data. Release 2: set SHAZAM_CRYPTO_V2=1 once release 1 is live everywhere.
 */
export function writeV2Keys(): boolean {
  return envVar('SHAZAM_CRYPTO_V2') === '1';
}

/** HKDF-SHA-256: 32 bytes of key material for one purpose, derived from the master secret string. */
export async function deriveKeyBytes(secret: string, info: string): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret) as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT as BufferSource, info: new TextEncoder().encode(info) as BufferSource },
    ikm,
    256
  );
  return new Uint8Array(bits);
}
