import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { buildGoogleAuthUrl, googleOAuthConfigured, googleRedirectUri } from '@/lib/google/oauth';
import { canConnectGoogle, googleAccessFor } from '@/lib/google/access';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch {
    return NextResponse.redirect(new URL('/login?next=/connections', req.url));
  }
  if (!googleOAuthConfigured()) {
    return NextResponse.redirect(new URL('/connections?google=not_configured', req.url));
  }

  // Testing mode: only approved early-access users can pass Google's test-user check.
  if (!canConnectGoogle(await googleAccessFor(user))) {
    return NextResponse.redirect(new URL('/connections?google=not_approved#apps', req.url));
  }

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildGoogleAuthUrl(state, googleRedirectUri(req.nextUrl.origin)));
  res.cookies.set({ name: 'shazam_google_oauth_state', value: state, httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/oauth/google', maxAge: 600 });
  return res;
}
