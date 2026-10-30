import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { buildGoogleAuthUrl, googleOAuthConfigured, googleRedirectUri } from '@/lib/google/oauth';

export async function GET(req: NextRequest) {
  try {
    await requireUser(req, new DbRepo());
  } catch {
    return NextResponse.redirect(new URL('/login?next=/connections', req.url));
  }
  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(new URL('/connections?google=not_configured', req.url));
  }

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildGoogleAuthUrl(state, googleRedirectUri(req.nextUrl.origin)));
  res.cookies.set({ name: 'shazam_google_oauth_state', value: state, httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/oauth/google', maxAge: 600 });
  return res;
}
