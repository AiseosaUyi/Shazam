import { NextRequest, NextResponse } from 'next/server';
import { runDueJobs } from '@/lib/jobs/runner';

export const maxDuration = 300;

/**
 * Vercel Cron (every minute, see vercel.json) → sends due scheduled emails and runs
 * scheduled Co-Work tasks. Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const results = await runDueJobs(10);
  return NextResponse.json({ ran: results.length, results: results.map((r) => ({ id: r.id, ok: r.ok })) });
}
