import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

const CreateConversationSchema = z.object({
  title: z.string().min(1).max(100).default('New Conversation'),
  projectId: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectIdParam = searchParams.get('projectId');
  const projectId = projectIdParam === 'none' ? null : projectIdParam || undefined;

  const conversations = await repo.listConversations(user.id, projectId);
  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // default title allowed
  }

  const parseResult = CreateConversationSchema.safeParse(body);
  const title = parseResult.success ? parseResult.data.title : 'New Conversation';
  const projectId = parseResult.success ? parseResult.data.projectId : undefined;

  const id = crypto.randomUUID();
  const conversation = await repo.createConversation(user.id, id, title, projectId);

  return NextResponse.json({ conversation });
}
