import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { syncVaultFromCookie, setVaultCookieOnResponse } from '@/lib/crypto/vault-cookie';
import { errMessage } from '@/lib/errors';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }

  await syncVaultFromCookie(req, user.id, repo, user.email);
  // Accept either a bare provider id ("google") or the credential id ("<userId>:google").
  const { id: rawId } = await params;
  const decoded = decodeURIComponent(rawId);
  const providerId = decoded.startsWith(`${user.id}:`) ? decoded.slice(user.id.length + 1) : decoded;
  if (providerId.includes(':')) return NextResponse.json({ error: 'Key not found.' }, { status: 404 });
  const deleted = await repo.deleteCredential(user.id, providerId);

  await repo.recordAuditEvent({
    id: crypto.randomUUID(),
    actorId: user.id,
    action: 'revoke_provider_key',
    targetType: 'provider',
    targetId: providerId,
    outcome: deleted ? 'success' : 'failure',
  });

  if (!deleted) return NextResponse.json({ error: 'Key not found.' }, { status: 404 });
  const response = NextResponse.json({ success: true, revoked: true });
  const remaining = await repo.getCredentials(user.id);
  if (remaining.length === 0) {
    response.cookies.delete('shazam_vault');
  } else {
    await setVaultCookieOnResponse(response, user.id, repo, user.email);
  }
  return response;
}
