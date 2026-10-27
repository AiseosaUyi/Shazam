import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

const CheckpointSchema = z.object({
  description: z.string().min(1).max(200).default('Manual checkpoint'),
});

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const checkpoints = await repo.getWorkspaceCheckpoints(user.id);
  return NextResponse.json({ checkpoints });
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
    // default description
  }

  const parseResult = CheckpointSchema.safeParse(body);
  const description = parseResult.success ? parseResult.data.description : 'Manual checkpoint';

  const currentFiles = await repo.getWorkspaceFiles(user.id);
  const filesMap: Record<string, string> = {};
  for (const f of currentFiles) {
    filesMap[f.path] = f.content;
  }

  const id = crypto.randomUUID();
  await repo.createWorkspaceCheckpoint(user.id, id, description, filesMap);

  return NextResponse.json({
    success: true,
    checkpoint: {
      id,
      description,
      fileCount: currentFiles.length,
      createdAt: new Date().toISOString(),
    },
  });
}
