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
  const checkpoint = await repo.getWorkspaceCheckpoint(user.id, id);
  if (!checkpoint) {
    return NextResponse.json({ error: 'Checkpoint not found.' }, { status: 404 });
  }

  // Clear current files and restore files from checkpoint
  const currentFiles = await repo.getWorkspaceFiles(user.id);
  for (const f of currentFiles) {
    await repo.deleteWorkspaceFile(user.id, f.path);
  }

  for (const [path, content] of Object.entries(checkpoint.files)) {
    await repo.putWorkspaceFile(user.id, path, content as string);
  }

  return NextResponse.json({
    success: true,
    message: `Restored ${Object.keys(checkpoint.files).length} files from checkpoint "${checkpoint.description}".`,
  });
}
