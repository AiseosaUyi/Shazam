import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

const FeedbackSchema = z.object({
  taskId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = FeedbackSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
      { status: 400 }
    );
  }

  const { taskId, rating, comment } = parseResult.data;
  const task = await repo.getTask(user.id, taskId);
  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }

  await repo.saveFeedback(user.id, taskId, rating as -1 | 1, comment || undefined);

  return NextResponse.json({ success: true });
}
