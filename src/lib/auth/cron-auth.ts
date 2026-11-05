import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of req.headers.authorization against `Bearer ${secret}`.
 *
 * Hashes both strings with SHA-256 first so length differences never leak through
 * early-exit behaviour in timingSafeEqual. Returns false if CRON_SECRET is unset
 * or empty.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || typeof secret !== 'string' || secret.length === 0) return false;

  const auth = req.headers.get('authorization');
  if (!auth || typeof auth !== 'string') return false;

  const expected = `Bearer ${secret}`;

  // Hash both strings so timingSafeEqual always receives fixed-length buffers.
  const expectedHash = createHash('sha256').update(expected).digest();
  const actualHash = createHash('sha256').update(auth).digest();

  if (actualHash.length !== expectedHash.length) return false;

  return timingSafeEqual(expectedHash, actualHash);
}
