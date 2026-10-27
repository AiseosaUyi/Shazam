import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { hashSessionToken } from '@/lib/crypto/auth';
import { SESSION_COOKIE_NAME, verifyCsrfOrigin } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  if (!verifyCsrfOrigin(req)) {
    return NextResponse.json({ error: 'CSRF validation failed.' }, { status: 403 });
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const repo = new DbRepo();
    const tokenHash = await hashSessionToken(token);
    await repo.deleteSession(tokenHash);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    path: '/',
    maxAge: 0,
  });

  return response;
}
