import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { errMessage } from '@/lib/errors';

export async function GET(
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

  const { id } = await params;
  const task = await repo.getTask(user.id, id);

  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }

  return NextResponse.json({ task });
}
