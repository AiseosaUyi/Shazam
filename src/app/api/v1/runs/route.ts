import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { RunsRepo } from '@/lib/runs/repo';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ runs: await new RunsRepo().list(user.id, 30) });
}
