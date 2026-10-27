import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireAdmin } from '@/lib/auth/session';

const StatusSchema = z.object({
  status: z.enum(['enabled', 'disabled']),
  reason: z.string().max(500).default('Provider kill switch toggled'),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const repo = new DbRepo();
  let admin;
  try {
    admin = await requireAdmin(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Forbidden' }, { status: 403 });
  }

  const { id: providerId } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = StatusSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid status.' },
      { status: 400 }
    );
  }

  const { status, reason } = parseResult.data;
  await repo.setCatalogOverride('provider', providerId, status, reason, admin.id);

  await repo.recordAuditEvent({
    id: crypto.randomUUID(),
    actorId: admin.id,
    action: 'admin_update_provider_status',
    targetType: 'provider',
    targetId: providerId,
    outcome: 'success',
    metadata: { status, reason },
  });

  return NextResponse.json({ success: true, providerId, status });
}
