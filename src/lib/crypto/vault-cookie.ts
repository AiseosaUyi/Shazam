import { NextRequest, NextResponse } from 'next/server';
import { encryptSecret, decryptSecret } from './vault';
import type { DbRepo } from '@/lib/db/repo';
import { isProduction } from '@/lib/env';

export const VAULT_COOKIE_NAME = 'shazam_vault';

export interface VaultCookiePayload {
  userId: string;
  email?: string;
  credentials: Array<{
    providerId: string;
    encryptedKey: string;
    keyHint: string;
    status: 'valid' | 'invalid' | 'untested';
    lastValidatedAt?: string | null;
  }>;
}

/**
 * Hydrates credentials from the request's shazam_vault cookie into the repo
 * if the database has 0 credentials for the user (e.g. across serverless Lambda containers).
 */
export async function syncVaultFromCookie(
  req: NextRequest,
  userId: string,
  repo: DbRepo,
  userEmail?: string
): Promise<void> {
  let cookieVal = req.cookies.get(VAULT_COOKIE_NAME)?.value;
  if (!cookieVal) return;

  try {
    try {
      cookieVal = decodeURIComponent(cookieVal);
    } catch {
      // ignore
    }

    const jsonStr = await decryptSecret(cookieVal);
    const data = JSON.parse(jsonStr) as VaultCookiePayload;
    if (!data || !Array.isArray(data.credentials) || data.credentials.length === 0) return;

    // Verify identity via userId or email
    const isMatch =
      data.userId === userId ||
      (Boolean(userEmail) && Boolean(data.email) && (data.email as string).toLowerCase().trim() === (userEmail as string).toLowerCase().trim());
    if (!isMatch) return;

    // Ensure user row exists in current database so foreign key constraints succeed
    try {
      const db = (repo as any).db;
      if (db) {
        const existing = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
        if (!existing) {
          const emailToUse = userEmail || data.email || `${userId}@shazam.ai`;
          await db
            .prepare(
              `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, status, onboarded, created_at)
               VALUES (?, ?, ?, '', 'user', 'active', 1, datetime('now'))`
            )
            .bind(userId, emailToUse.toLowerCase().trim(), userId)
            .run();
        }
      }
    } catch {
      // ignore
    }

    for (const cred of data.credentials) {
      await repo.setCredential({
        id: `${userId}:${cred.providerId}`,
        userId,
        providerId: cred.providerId,
        encryptedKey: cred.encryptedKey,
        keyHint: cred.keyHint,
        status: cred.status,
      });
    }
  } catch {
    // ignore decryption or parsing errors
  }
}

/**
 * Packs all of a user's current credentials into an encrypted, HttpOnly shazam_vault cookie
 * and sets it on the response so they persist across any serverless container.
 */
export async function setVaultCookieOnResponse(
  response: NextResponse,
  userId: string,
  repo: DbRepo,
  userEmail?: string
): Promise<void> {
  try {
    const creds = await repo.getCredentialsWithSecrets(userId);
    if (creds.length === 0) return;

    const payload: VaultCookiePayload = {
      userId,
      email: userEmail,
      credentials: creds.map((c) => ({
        providerId: c.providerId,
        encryptedKey: c.encryptedKey,
        keyHint: c.keyHint,
        status: c.status,
        lastValidatedAt: c.lastValidatedAt,
      })),
    };

    const encryptedPayload = await encryptSecret(JSON.stringify(payload));

    response.cookies.set({
      name: VAULT_COOKIE_NAME,
      value: encryptedPayload,
      httpOnly: true,
      secure: isProduction(),
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  } catch {
    // ignore
  }
}
