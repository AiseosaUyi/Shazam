import { NextRequest, NextResponse } from 'next/server';
import { encryptSecret, decryptSecret } from './vault';
import type { DbRepo } from '@/lib/db/repo';
import { isProduction } from '@/lib/env';

export const VAULT_COOKIE_NAME = 'shazam_vault';

export interface VaultCookiePayload {
  userId: string;
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
export async function syncVaultFromCookie(req: NextRequest, userId: string, repo: DbRepo): Promise<void> {
  const cookieVal = req.cookies.get(VAULT_COOKIE_NAME)?.value;
  if (!cookieVal) return;

  try {
    const jsonStr = await decryptSecret(cookieVal);
    const data = JSON.parse(jsonStr) as VaultCookiePayload;
    if (data.userId !== userId || !Array.isArray(data.credentials)) return;

    // Ensure user row exists in current database so foreign key constraints succeed
    try {
      const db = (repo as any).db;
      if (db) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, status, onboarded, created_at)
             VALUES (?, ?, ?, '', 'user', 'active', 1, datetime('now'))`
          )
          .bind(userId, `${userId}@shazam.ai`, userId)
          .run();
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
export async function setVaultCookieOnResponse(response: NextResponse, userId: string, repo: DbRepo): Promise<void> {
  try {
    const creds = await repo.getCredentialsWithSecrets(userId);
    const payload: VaultCookiePayload = {
      userId,
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
