import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { callDevice, BridgeOfflineError } from '@/lib/bridge/repo';
import { recommendModel, isValidModelName } from '@/lib/local-ai/recommend';
import { errMessage } from '@/lib/errors';

const ActionSchema = z.object({
  action: z.enum(['pull', 'pull-progress', 'create', 'start']),
  model: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await callDevice(user.id, 'desktop', 'local_status', {}, { timeoutMs: 15000 });
    if (!res.ok) return NextResponse.json({ connected: true, error: String(res.result) }, { status: 502 });
    const status = res.result || {};
    return NextResponse.json({ connected: true, ...status, recommended: recommendModel(status.hardware?.ramGB ?? 0) });
  } catch (err) {
    if (err instanceof BridgeOfflineError) {
      return NextResponse.json({ connected: false, error: errMessage(err) }, { status: 200 });
    }
    return NextResponse.json({ error: err instanceof Error ? errMessage(err) : 'Unknown error' }, { status: 504 });
  }
}

export async function POST(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) || 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = ActionSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.issues[0]?.message || 'Invalid action.' }, { status: 400 });
  }

  const { action, model } = parseResult.data;

  // model is required for pull, pull-progress, create
  if (['pull', 'pull-progress', 'create'].includes(action)) {
    if (!model || !isValidModelName(model)) {
      return NextResponse.json({ error: 'Invalid model name.' }, { status: 400 });
    }
  }

  let command: string, payload: Record<string, unknown>, timeoutMs: number;

  switch (action) {
    case 'pull':
      command = 'local_pull';
      payload = { model };
      timeoutMs = 15000;
      break;
    case 'pull-progress':
      command = 'local_pull_progress';
      payload = { model };
      timeoutMs = 15000;
      break;
    case 'create':
      command = 'local_create';
      payload = { from: model };
      timeoutMs = 120000;
      break;
    case 'start':
      command = 'ollama_start';
      payload = {};
      timeoutMs = 15000;
      break;
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }

  try {
    const result = await callDevice(user.id, 'desktop', command, payload, { timeoutMs });
    if (!result.ok) {
      return NextResponse.json({ error: String(result.result) }, { status: 400 });
    }
    return NextResponse.json({ result: result.result });
  } catch (err) {
    if (err instanceof BridgeOfflineError) {
      return NextResponse.json({ error: errMessage(err) }, { status: 409 });
    }
    return NextResponse.json({ error: err instanceof Error ? errMessage(err) : 'Unknown error' }, { status: 504 });
  }
}
