import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { validateFileChanges, computeUnifiedDiff, type FileChange } from '@/lib/agent/policy';

const ChangeItemSchema = z.object({
  path: z.string().min(1),
  action: z.enum(['create', 'update', 'delete']),
  content: z.string().optional(),
});

const ProposalSchema = z.object({
  instruction: z.string().min(1),
  summary: z.string().min(1),
  changes: z.array(ChangeItemSchema).min(1),
  taskId: z.string().optional(),
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
  const id = searchParams.get('id');

  if (id) {
    const prop = await repo.getWorkspaceProposal(user.id, id);
    if (!prop) {
      return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
    }
    return NextResponse.json({ proposal: prop });
  }

  // Get all proposals
  const proposals = await repo.getWorkspaceProposals(user.id);
  return NextResponse.json({ proposals });
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

  const parseResult = ProposalSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid input.' },
      { status: 400 }
    );
  }

  const { instruction, summary, changes, taskId } = parseResult.data;

  // Validate changes against security policy
  const validation = validateFileChanges(changes as FileChange[]);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Compute diffs against existing workspace files for preview
  const enrichedChanges: any[] = [];
  for (const c of changes) {
    const existing = await repo.getWorkspaceFile(user.id, c.path);
    const oldContent = existing?.content ?? null;
    const newContent = c.action === 'delete' ? null : (c.content ?? '');
    const diff = computeUnifiedDiff(c.path, oldContent, newContent);
    enrichedChanges.push({
      ...c,
      diff,
    });
  }

  const id = crypto.randomUUID();
  await repo.createWorkspaceProposal(user.id, {
    id,
    instruction,
    summary,
    changes: enrichedChanges,
    taskId,
  });

  return NextResponse.json({
    success: true,
    proposal: {
      id,
      instruction,
      summary,
      changes: enrichedChanges,
      status: 'pending',
    },
  });
}
