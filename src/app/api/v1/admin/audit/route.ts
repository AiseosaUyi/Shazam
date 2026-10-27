import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireAdmin } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  try {
    await requireAdmin(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Forbidden' }, { status: 403 });
  }

  const auditEvents = await repo.getAuditEvents(100);
  return NextResponse.json({ auditEvents });
}
