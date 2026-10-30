import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { suggestAgent } from '@/lib/agents/suggest';
import { loadSuggestContext } from '@/lib/agents/context';

const Schema = z.object({ prompt: z.string().min(1).max(20000) });

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  return NextResponse.json({ suggestion: suggestAgent(parsed.data.prompt, await loadSuggestContext(user.id)) });
}
