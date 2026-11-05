import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { RunsRepo } from '@/lib/runs/repo';
import { errMessage } from '@/lib/errors';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const run = await new RunsRepo().get(user.id, id);
  return run ? NextResponse.json({ run }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
