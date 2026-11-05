import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/auth/client-ip';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { verifyPassword, hashSessionToken } from '@/lib/crypto/auth';
import { createSignedSessionToken } from '@/lib/crypto/session-token';
import { isProduction } from '@/lib/env';
import { isEmailConfiguredAdmin, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, verifyCsrfOrigin } from '@/lib/auth/session';
import { errMessage } from '@/lib/errors';

// Same PBKDF2 cost as a real hash, so unknown emails take as long to reject as wrong passwords.
const DUMMY_HASH = `pbkdf2:100000:${'00'.repeat(16)}:${'00'.repeat(32)}`;

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
    const ip = clientIp(req);

    // Rate limit: 10 login attempts per minute per IP
    const { allowed } = await repo.checkRateLimit(`login:${ip}`, 60, 10);
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

    // Per-account throttle on top of the per-IP one, so a botnet can't grind a single account.
    const acct = await repo.checkRateLimit(`login-acct:${email.toLowerCase().trim()}`, 300, 8);
    if (!acct.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts for this account. Please wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    const user = await repo.getUserByEmail(email);

    if (!user) {
      await verifyPassword(password, DUMMY_HASH);
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    // Only reveal suspension to someone who actually knows the password.
    if (user.status === 'suspended') {
      return NextResponse.json({ error: 'This account has been suspended.' }, { status: 403 });
    }

    let role = user.role;
    if (role !== 'admin' && isEmailConfiguredAdmin(user.email)) {
      role = 'admin';
    }

    // Create signed session (valid both via DB lookup and statelessly across serverless containers)
    const sessionToken = await createSignedSessionToken(
      { id: user.id, email: user.email, role },
      SESSION_MAX_AGE_SECONDS
    );
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
  } catch (err) {
    return NextResponse.json(
      { error: isProduction() ? 'Authentication service error. Please try again.' : (errMessage(err) || 'Authentication service error. Please try again.') },
      { status: 500 }
    );
  }
}
