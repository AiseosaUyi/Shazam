import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { completeGoogleOAuth, googleRedirectUri } from '@/lib/google/oauth';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch {
    return NextResponse.redirect(new URL('/login?next=/connections', req.url));
  }

  const state = req.nextUrl.searchParams.get('state');
  const code = req.nextUrl.searchParams.get('code');
  const expected = req.cookies.get('shazam_google_oauth_state')?.value;
  const done = (status: string) => {
    const res = NextResponse.redirect(new URL(`/connections?google=${status}`, req.url));
    res.cookies.delete({ name: 'shazam_google_oauth_state', path: '/api/v1/oauth/google' });
    return res;
  };

  if (req.nextUrl.searchParams.get('error')) return done('denied');
  if (!state || !expected || state !== expected || !code) return done('invalid_state');

  try {
    await completeGoogleOAuth(user.id, code, googleRedirectUri(req.nextUrl.origin));
    return done('connected');
  } catch (err) {
    console.error('[google-oauth] token exchange failed', err instanceof Error ? errMessage(err) : err);
    return done('error');
  }
}
