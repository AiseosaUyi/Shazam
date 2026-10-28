import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { hashPassword, hashSessionToken } from '@/lib/crypto/auth';
import { envFlag, isProduction } from '@/lib/env';
import { getAdminEmails, isEmailConfiguredAdmin, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, verifyCsrfOrigin } from '@/lib/auth/session';

const SignupSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters long').max(128),
});

export async function POST(req: NextRequest) {
  try {
    if (!verifyCsrfOrigin(req)) {
      return NextResponse.json({ error: 'CSRF validation failed.' }, { status: 403 });
    }

    const repo = new DbRepo();
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '127.0.0.1';

    // Rate limit: 5 signups per minute per IP
    const allowed = await repo.checkRateLimit(`signup:${ip}`, 5, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please wait a moment and try again.' },
        { status: 429 }
      );
    }

    if (envFlag('SHAZAM_ALLOW_SIGNUP', true) === false) {
      return NextResponse.json(
        { error: 'Public registration is currently disabled.' },
        { status: 403 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    const parseResult = SignupSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
        { status: 400 }
      );
    }

    const { email, password } = parseResult.data;
    const existingUser = await repo.getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Please sign in instead.' },
        { status: 409 }
      );
    }

    // Check if this is the first user in the system
    const userCount = await repo.getUserCount();
    const isFirstUser = userCount === 0 && getAdminEmails().length === 0;
    const role = isFirstUser || isEmailConfiguredAdmin(email) ? 'admin' : 'user';

    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID();

    const user = await repo.createUser({
      id: userId,
      email,
      name: email.split('@')[0],
      passwordHash,
      role,
    });

    // Create session
    const sessionToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const tokenHash = await hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

    await repo.createSession(tokenHash, user.id, expiresAt);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        onboarded: user.onboarded,
      },
    });

    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: isProduction(),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal registration error.' },
      { status: 500 }
    );
  }
}
