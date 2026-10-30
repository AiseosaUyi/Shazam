import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { verifyCsrfOrigin } from '@/lib/auth/session';
import { syncVaultFromCookie } from '@/lib/crypto/vault-cookie';
import { executeRun } from '@/lib/runs/background';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { RunsRepo } from '@/lib/runs/repo';

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ runs: await new RunsRepo().list(user.id, 30) });
}

export const maxDuration = 800;

const StartSchema = z.object({
  agent: z.enum(['code', 'cowork']),
  prompt: z.string().min(1).max(20000),
  projectId: z.string().max(64).optional(),
  localRoot: z.string().max(1024).optional(),
  pinnedModel: z.string().max(120).optional(),
  timezone: z.string().max(64).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).max(20).optional(),
});

/** Starts a durable background run (survives refreshes, network blips and closed tabs). */
export async function POST(req: NextRequest) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  await syncVaultFromCookie(req, user.id, repo, user.email);
  const parsed = StartSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const d = parsed.data;
  const run = await new RunsRepo().create(user.id, { agent: d.agent, prompt: d.prompt, projectId: d.localRoot ? `local:${d.localRoot}` : d.projectId, source: 'web' });
  after(() => executeRun(user, run, { history: d.history, timezone: d.timezone, pinnedModel: d.pinnedModel }));
  return NextResponse.json({ run }, { status: 201 });
}
