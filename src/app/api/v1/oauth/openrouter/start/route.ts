import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

/**
 * One-click OpenRouter connect (OAuth PKCE): OpenRouter mints a user-controlled API key for
 * Arcwork, so the user never copies a key. The verifier lives in an httpOnly cookie scoped to
 * this route family, which also binds the returned code to this browser.
 */
const COOKIE = 'shazam_openrouter_pkce';

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function GET(req: NextRequest) {
  try {
    await requireUser(req, new DbRepo());
  } catch {
    return NextResponse.redirect(new URL('/login?next=/onboarding', req.url));
  }

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const callback = new URL('/api/v1/oauth/openrouter/callback', req.nextUrl.origin).toString();

  const auth = new URL('https://openrouter.ai/auth');
  auth.searchParams.set('callback_url', callback);
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');

  const res = NextResponse.redirect(auth);
  res.cookies.set({ name: COOKIE, value: verifier, httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/oauth/openrouter', maxAge: 600 });
  return res;
}
