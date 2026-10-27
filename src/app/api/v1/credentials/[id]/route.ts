import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const { id: providerId } = await params;
  const deleted = await repo.deleteCredential(user.id, providerId);

  await repo.recordAuditEvent({
    id: crypto.randomUUID(),
    actorId: user.id,
    action: 'revoke_provider_key',
    targetType: 'provider',
    targetId: providerId,
    outcome: deleted ? 'success' : 'failure',
  });

  return NextResponse.json({ success: true, revoked: deleted });
}
