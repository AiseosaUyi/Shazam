import { NextRequest, NextResponse } from 'next/server';
import { runDueJobs } from '@/lib/jobs/runner';
import { isCronAuthorized } from '@/lib/auth/cron-auth';

export const maxDuration = 300;

/**
 * Vercel Cron (every minute, see vercel.json) → sends due scheduled emails and runs
 * scheduled Co-Work tasks. Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const results = await runDueJobs(10);
  return NextResponse.json({ ran: results.length, results: results.map((r) => ({ id: r.id, ok: r.ok })) });
}
