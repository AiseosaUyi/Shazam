import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { RECURRENCES } from '@/lib/jobs/recurrence';
import { errMessage } from '@/lib/errors';

const Patch = z.object({
  action: z.enum(['pause', 'resume', 'cancel', 'update']),
  title: z.string().max(200).optional(),
  runAt: z.string().optional(),
  recurrence: z.enum(RECURRENCES as [string, ...string[]]).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

async function auth(req: NextRequest) {
  return requireUser(req, new DbRepo());
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await auth(req);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const platform = new PlatformRepo();
  const job = await platform.getJob(user.id, id);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ job, runs: await platform.listJobRuns(user.id, id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  let user;
  try {
    user = await auth(req);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const platform = new PlatformRepo();
  const { action } = parsed.data;

  let ok = false;
  if (action === 'pause') ok = await platform.setJobStatus(user.id, id, 'paused');
  else if (action === 'resume') ok = await platform.setJobStatus(user.id, id, 'scheduled');
  else if (action === 'cancel') ok = await platform.setJobStatus(user.id, id, 'cancelled');
  else {
    if (parsed.data.runAt && Number.isNaN(new Date(parsed.data.runAt).getTime())) {
      return NextResponse.json({ error: 'runAt must be an ISO date-time' }, { status: 400 });
    }
    ok = await platform.updateJob(user.id, id, {
      title: parsed.data.title,
      runAt: parsed.data.runAt ? new Date(parsed.data.runAt).toISOString() : undefined,
      payload: parsed.data.payload,
      recurrence: parsed.data.recurrence,
    });
  }
  if (!ok) return NextResponse.json({ error: 'Schedule not found or no longer editable.' }, { status: 409 });
  return NextResponse.json({ job: await platform.getJob(user.id, id) });
}
