import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { OAuthServer } from '@/lib/oauth/server';

/** Called by the consent page. GET validates the request; POST records the user's decision. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const v = await new OAuthServer().validateAuthorize({
    response_type: q.get('response_type'), client_id: q.get('client_id'), redirect_uri: q.get('redirect_uri'),
    code_challenge: q.get('code_challenge'), code_challenge_method: q.get('code_challenge_method'),
  });
  if ('error' in v) return NextResponse.json(v, { status: 400 });
  return NextResponse.json({ clientName: v.client.name, redirectHost: new URL(q.get('redirect_uri')!).host });
}

export async function POST(req: NextRequest) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const server = new OAuthServer();
  const v = await server.validateAuthorize(body);
  if ('error' in v) return NextResponse.json(v, { status: 400 });
  const redirect = new URL(body.redirect_uri);
  if (body.state) redirect.searchParams.set('state', body.state);
  if (body.decision !== 'allow') {
    redirect.searchParams.set('error', 'access_denied');
    return NextResponse.json({ redirect: redirect.toString() });
  }
  const code = await server.issueCode(user.id, v.client.clientId, body.redirect_uri, body.code_challenge);
  redirect.searchParams.set('code', code);
  return NextResponse.json({ redirect: redirect.toString() });
}
