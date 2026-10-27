import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(100),
  description: z.string().max(500).optional(),
  rootDir: z.string().default('/'),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const projects = await repo.getProjects(user.id);
  return NextResponse.json({ projects });
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

  const parseResult = CreateProjectSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
      { status: 400 }
    );
  }

  const { name, description, rootDir, settings } = parseResult.data;
  const projectId = `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  await repo.createProject(user.id, {
    id: projectId,
    name,
    description: description || null,
    rootDir,
    settings: settings || {},
  });

  const project = await repo.getProject(user.id, projectId);
  return NextResponse.json({ project }, { status: 201 });
}
