import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { validateFilePath } from '@/lib/agent/policy';

const FileSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(256 * 1024, 'File exceeds 256KB limit'),
});

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

  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path');

  const files = await repo.getProjectFiles(user.id, projectId);

  if (path) {
    const file = files.find((f) => f.path === path);
    if (!file) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    return NextResponse.json({ file });
  }

  return NextResponse.json({ files });
}

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

  const { id: projectId } = await params;
  const project = await repo.getProject(user.id, projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = FileSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
      { status: 400 }
    );
  }

  const { path, content } = parseResult.data;
  const validation = validateFilePath(path);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  await repo.putProjectFile(user.id, projectId, path, content);

  return NextResponse.json({ success: true, path, updatedAt: new Date().toISOString() });
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
  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path');

  if (!path) {
    return NextResponse.json({ error: 'Missing path query parameter.' }, { status: 400 });
  }

  const deleted = await repo.deleteProjectFile(user.id, projectId, path);
  if (!deleted) {
    return NextResponse.json({ error: 'File not found or already deleted.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, path });
}
