import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

const DecideSchema = z.object({
  decision: z.enum(['applied', 'rejected']),
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

  const { id } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = DecideSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid decision.' },
      { status: 400 }
    );
  }

  const { decision } = parseResult.data;
  const proposal = await repo.getWorkspaceProposal(user.id, id);
  if (!proposal) {
    return NextResponse.json({ error: 'Proposal not found.' }, { status: 404 });
  }

  if (proposal.status !== 'pending') {
    return NextResponse.json(
      { error: `Proposal has already been ${proposal.status}.` },
      { status: 400 }
    );
  }

  if (decision === 'applied') {
    // Apply changes to workspace_files
    for (const change of proposal.changes) {
      if (change.action === 'delete') {
        await repo.deleteWorkspaceFile(user.id, change.path);
      } else {
        await repo.putWorkspaceFile(user.id, change.path, change.content ?? '');
      }
    }
  }

  await repo.decideWorkspaceProposal(user.id, id, decision);

  return NextResponse.json({ success: true, status: decision });
}
