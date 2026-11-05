import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireAdmin } from '@/lib/auth/session';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  try {
    await requireAdmin(req, repo);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Forbidden' }, { status: 403 });
  }

  const auditEvents = await repo.getAuditEvents(100);
  return NextResponse.json({ auditEvents });
}
