import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

export async function POST(
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

  const { id } = await params;
  const task = await repo.getTask(user.id, id);

  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }

  if (task.status === 'running') {
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    await repo.updateTask(task);
  }

  return NextResponse.json({ success: true, status: task.status });
}
