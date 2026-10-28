import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { encryptSecret, maskKey } from '@/lib/crypto/vault';
import { syncVaultFromCookie, setVaultCookieOnResponse } from '@/lib/crypto/vault-cookie';

const CredentialSchema = z.object({
  providerId: z.string().min(1),
  apiKey: z.string().min(4, 'API key is too short').max(512),
});

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  await syncVaultFromCookie(req, user.id, repo);
  const credentials = await repo.getCredentials(user.id);
  const safeCredentials = credentials.map((c) => ({
    id: c.id,
    providerId: c.providerId,
    keyMask: c.keyHint,
    status: c.status,
    lastValidatedAt: c.lastValidatedAt,
  }));

  const response = NextResponse.json({ credentials: safeCredentials });
  await setVaultCookieOnResponse(response, user.id, repo);
  return response;
}

export async function POST(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  await syncVaultFromCookie(req, user.id, repo);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = CredentialSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
      { status: 400 }
    );
  }

  const { providerId, apiKey } = parseResult.data;

  // Encrypt secret with AES-256-GCM
  let encryptedKey: string;
  try {
    encryptedKey = await encryptSecret(apiKey.trim());
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Encryption failed.' },
      { status: 500 }
    );
  }

  const keyMask = maskKey(apiKey.trim());
  const now = new Date().toISOString();
  const id = `${user.id}:${providerId}`;

  await repo.setCredential({
    id,
    userId: user.id,
    providerId,
    encryptedKey,
    keyHint: keyMask,
    status: 'valid',
  });

  const response = NextResponse.json({
    success: true,
    credential: {
      id,
      providerId,
      keyMask,
      status: 'valid',
      lastValidatedAt: now,
    },
  });

  // Pack credentials into encrypted, persistent cookie for cross-container serverless durability
  await setVaultCookieOnResponse(response, user.id, repo);

  return response;
}
