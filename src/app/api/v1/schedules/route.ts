import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { requireUser } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  const all = req.nextUrl.searchParams.get('all') === '1';
  return NextResponse.json({ jobs: await new PlatformRepo().listJobs(user.id, { includeFinished: all }) });
}
