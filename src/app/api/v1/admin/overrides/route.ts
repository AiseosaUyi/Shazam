import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireAdmin } from '@/lib/auth/session';

const OverrideSchema = z.object({
  targetType: z.enum(['provider', 'route']),
  targetId: z.string().min(1),
  status: z.enum(['enabled', 'disabled']),
  reason: z.string().max(500).default('Admin override'),
});

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  try {
    await requireAdmin(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Forbidden' }, { status: 403 });
  }

  const overrides = await repo.getCatalogOverrides();
  return NextResponse.json({ overrides });
}

export async function PATCH(req: NextRequest) {
  const repo = new DbRepo();
  let admin;
  try {
    admin = await requireAdmin(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Forbidden' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = OverrideSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid parameters.' },
      { status: 400 }
    );
  }

  const { targetType, targetId, status, reason } = parseResult.data;
  await repo.setCatalogOverride(targetType, targetId, status, reason, admin.id);

  await repo.recordAuditEvent({
    id: crypto.randomUUID(),
    actorId: admin.id,
    action: 'set_catalog_override',
    targetType,
    targetId,
    outcome: 'success',
    metadata: { status, reason },
  });

  return NextResponse.json({ success: true, targetType, targetId, status });
}
