import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { verifyPassword, hashSessionToken } from '@/lib/crypto/auth';
import { isProduction } from '@/lib/env';
import { isEmailConfiguredAdmin, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, verifyCsrfOrigin } from '@/lib/auth/session';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required.'),
});

export async function POST(req: NextRequest) {
  try {
    if (!verifyCsrfOrigin(req)) {
      return NextResponse.json({ error: 'CSRF validation failed.' }, { status: 403 });
    }

    const repo = new DbRepo();
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '127.0.0.1';

    // Rate limit: 10 login attempts per minute per IP
    const allowed = await repo.checkRateLimit(`login:${ip}`, 10, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait a minute and try again.' },
        { status: 429 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    const parseResult = LoginSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
        { status: 400 }
      );
    }

    const { email, password } = parseResult.data;
    const user = await repo.getUserByEmail(email);

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    if (user.status === 'suspended') {
      return NextResponse.json({ error: 'This account has been suspended.' }, { status: 403 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    let role = user.role;
    if (role !== 'admin' && isEmailConfiguredAdmin(user.email)) {
      role = 'admin';
    }

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
        role,
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
      { error: err.message || 'Authentication service error. Please try again.' },
      { status: 500 }
    );
  }
}
