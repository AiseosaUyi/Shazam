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

/** Stop a run. The runner watches for the cancelled status and aborts the model loop. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const runs = new RunsRepo();
  const run = await runs.get(user.id, id);
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const cancelled = await runs.cancel(user.id, id);
  return NextResponse.json({ cancelled, status: cancelled ? 'cancelled' : run.status });
}
