import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { executeApprovedAction } from '@/lib/cowork/actions';

export const maxDuration = 60;

const Schema = z.object({
  decision: z.enum(['approve', 'reject']),
  /** Optional edits the user made in the approval card (e.g. email body). */
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'decision must be approve or reject' }, { status: 400 });

  const platform = new PlatformRepo();
  const action = await platform.getPendingAction(user.id, id);
  if (!action) return NextResponse.json({ error: 'Action not found' }, { status: 404 });

  if (parsed.data.decision === 'reject') {
    await platform.decidePendingAction(user.id, id, 'rejected');
    return NextResponse.json({ status: 'rejected' });
  }

  // Exactly-once: only the request that flips pending → approved executes.
  if (!(await platform.decidePendingAction(user.id, id, 'approved'))) {
    return NextResponse.json({ error: 'This action was already approved or rejected.' }, { status: 409 });
  }
  const edited = parsed.data.payload ? { ...action, payload: { ...action.payload, ...parsed.data.payload } } : action;
  const outcome = await executeApprovedAction(edited, platform);
  await platform.completePendingAction(user.id, id, outcome.ok, outcome.result);
  return NextResponse.json({ status: outcome.ok ? 'executed' : 'failed', result: outcome.result }, { status: outcome.ok ? 200 : 502 });
}
