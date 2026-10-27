import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { validateFilePath } from '@/lib/agent/policy';

const FileSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(256 * 1024, 'File exceeds 256KB limit'),
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
  const path = searchParams.get('path');

  if (path) {
    const file = await repo.getWorkspaceFile(user.id, path);
    if (!file) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    return NextResponse.json({ file });
  }

  const files = await repo.getWorkspaceFiles(user.id);
  return NextResponse.json({ files });
}

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

  const parseResult = FileSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
      { status: 400 }
    );
  }

  const { path, content } = parseResult.data;
  const pathValidation = validateFilePath(path);
  if (!pathValidation.valid) {
    return NextResponse.json({ error: pathValidation.error }, { status: 400 });
  }

  await repo.putWorkspaceFile(user.id, path, content);
  return NextResponse.json({ success: true, path });
}

export async function DELETE(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'Path parameter is required.' }, { status: 400 });
  }

  const deleted = await repo.deleteWorkspaceFile(user.id, path);
  if (!deleted) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
