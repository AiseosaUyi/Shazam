import type { NextRequest } from 'next/server';

/** Best-effort client IP for rate limiting (Vercel sets x-forwarded-for; take the first hop). */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  return req.headers.get('cf-connecting-ip') || (fwd ? fwd.split(',')[0].trim() : '') || req.headers.get('x-real-ip') || '127.0.0.1';
}
