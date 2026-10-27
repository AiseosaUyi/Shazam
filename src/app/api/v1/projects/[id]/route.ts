import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

export async function GET(
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

  const { id: projectId } = await params;
  const project = await repo.getProject(user.id, projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function DELETE(
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

  const { id: projectId } = await params;
  const deleted = await repo.deleteProject(user.id, projectId);
  if (!deleted) {
    return NextResponse.json({ error: 'Project not found or already deleted.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, deletedId: projectId });
}
