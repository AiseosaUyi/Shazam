import { NextRequest, NextResponse, after } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { resumeNextRun } from '@/lib/runs/background';
import { isCronAuthorized } from '@/lib/auth/cron-auth';

// Each resumed segment runs inside this invocation, so it gets the same budget as a run.
export const maxDuration = 800;

/**
 * Continues background runs that paused at a time limit or whose invocation died.
 * Called by Vercel Cron every minute (GET) and kicked right after a run pauses (POST).
 * Takes one run per call; the run's next pause kicks the next call.
 */
async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const repo = new DbRepo();
  after(() => resumeNextRun((id) => repo.getUserById(id)).catch(() => null));
  return NextResponse.json({ ok: true });
}

export const GET = handle;
export const POST = handle;
