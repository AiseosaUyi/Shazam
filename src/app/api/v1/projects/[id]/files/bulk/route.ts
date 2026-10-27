import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { validateFilePath } from '@/lib/agent/policy';

const BulkFilesSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string().max(256 * 1024, 'Single file exceeds 256KB limit'),
    })
  ).min(1).max(200, 'Maximum 200 files per batch'),
});

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

  const parseResult = BulkFilesSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
      { status: 400 }
    );
  }

  const validFiles: Array<{ path: string; content: string }> = [];
  for (const f of parseResult.data.files) {
    const check = validateFilePath(f.path);
    if (check.valid) {
      validFiles.push(f);
    }
  }

  if (validFiles.length === 0) {
    return NextResponse.json({ error: 'No files passed security path validation.' }, { status: 400 });
  }

  const count = await repo.putProjectFilesBulk(user.id, projectId, validFiles);

  return NextResponse.json({
    success: true,
    importedCount: count,
    skippedCount: parseResult.data.files.length - count,
  });
}
