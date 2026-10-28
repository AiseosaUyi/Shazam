import { NextRequest } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { hashSessionToken } from '@/lib/crypto/auth';
import { envVar, isProduction } from '@/lib/env';
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
    return (
      originHost === hostName ||
      originHost.endsWith('.workers.dev') ||
      originHost === 'localhost' ||
      originHost === '127.0.0.1'
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

  const tokenHash = await hashSessionToken(token);
  const sessionResult = await repo.getSession(tokenHash);
  if (!sessionResult) {
    return null;
  }

  let user = sessionResult.user;

  // Upgrade to admin if email is in ADMIN_EMAILS
  if (user.role !== 'admin' && isEmailConfiguredAdmin(user.email)) {
    user = { ...user, role: 'admin' };
  }

  return user;
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
