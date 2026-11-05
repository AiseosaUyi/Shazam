import { NextRequest } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { hashSessionToken } from '@/lib/crypto/auth';
import { verifySignedSessionToken } from '@/lib/crypto/session-token';
import { envVar, getDb, isProduction } from '@/lib/env';
import type { User } from '@/lib/types';

export const SESSION_COOKIE_NAME = 'shazam_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function getAdminEmails(): string[] {
  const raw = envVar('ADMIN_EMAILS') || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isEmailConfiguredAdmin(email: string): boolean {
  return getAdminEmails().includes(email.toLowerCase().trim());
}

/**
 * Validates Origin header for mutating requests (CSRF protection).
 */
export function verifyCsrfOrigin(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return true;
  }

  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (!origin || !host) {
    // In desktop app (Electron) or headless API calls without origin header
    return true;
  }

  try {
    const originUrl = new URL(origin);
    const hostName = host.split(':')[0].toLowerCase();
    const originHost = originUrl.hostname.toLowerCase();
    // Only the app's own host. A blanket *.workers.dev allowance lets any attacker-owned Worker
    // make cross-site requests with the victim's cookies. Loopback is for local dev only.
    return (
      originHost === hostName ||
      (!isProduction() && (originHost === 'localhost' || originHost === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}

/**
 * Retrieves the authenticated user for the incoming request.
 */
export async function getCurrentUser(req: NextRequest, repo = new DbRepo()): Promise<User | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token || token.length < 16) {
    return null;
  }

  // 1. Check DB session first (Cloudflare D1 or local SQLite)
  let sessionLookupFailed = false;
  try {
    const tokenHash = await hashSessionToken(token);
    const sessionResult = await repo.getSession(tokenHash);
    if (sessionResult) {
      let user = sessionResult.user;
      if (user.role !== 'admin' && isEmailConfiguredAdmin(user.email)) {
        user = { ...user, role: 'admin' };
      }
      return user;
    }
  } catch {
    sessionLookupFailed = true; // DB unreachable: the signed token is all we can check
  }

  // 2. Cryptographic signed token fallback (resilient across serverless Lambda containers)
  const claim = await verifySignedSessionToken(token);
  if (claim) {
    let role = (claim.r as 'admin' | 'user') || 'user';
    if (role !== 'admin' && isEmailConfiguredAdmin(claim.e)) {
      role = 'admin';
    }

    // Hydrate user in current runtime database so relational joins & rate-limits succeed
    let resolvedUserId = claim.u;
    try {
      const db = (repo as unknown as { db?: ReturnType<typeof getDb> }).db ?? getDb();
      // Check if the account already exists here (possibly with a pre-seeded ID such as usr_admin_01)
      const existing = await db
        .prepare('SELECT id, role, status FROM users WHERE email = ?')
        .bind(claim.e.toLowerCase().trim())
        .first<{ id: string; role?: string; status?: string }>();

      if (existing) {
        // A suspended account must not get back in through a still-valid signature.
        if (existing.status === 'suspended') return null;
        // The account lives in this database but its session row is gone: the user logged out
        // (or an admin revoked it). A valid signature alone must not resurrect that session.
        if (!sessionLookupFailed) return null;
        resolvedUserId = existing.id;
        role = existing.role === 'admin' ? 'admin' : (isEmailConfiguredAdmin(claim.e) ? 'admin' : 'user');
      } else {
        await db
          .prepare(
            `INSERT INTO users (id, email, name, password_hash, role, status, onboarded, created_at)
             VALUES (?, ?, ?, ?, ?, 'active', 1, datetime('now'))`
          )
          .bind(claim.u, claim.e.toLowerCase().trim(), claim.e.split('@')[0], '', role)
          .run();
      }
    } catch {
      // ignore
    }

    const user: User = {
      id: resolvedUserId,
      email: claim.e,
      name: claim.e.split('@')[0],
      role,
      status: 'active',
      onboarded: true,
      createdAt: new Date().toISOString(),
    };

    return user;
  }

  return null;
}

export async function requireUser(req: NextRequest, repo = new DbRepo()): Promise<User> {
  if (!verifyCsrfOrigin(req)) {
    throw new Error('CSRF origin check failed.');
  }

  const user = await getCurrentUser(req, repo);
  if (!user || user.status === 'suspended') {
    throw new Error('Unauthorized');
  }
  return user;
}

export async function requireAdmin(req: NextRequest, repo = new DbRepo()): Promise<User> {
  const user = await requireUser(req, repo);
  if (user.role !== 'admin') {
    throw new Error('Forbidden: Admin role required.');
  }
  return user;
}
