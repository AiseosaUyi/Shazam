import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser, verifyCsrfOrigin } from '@/lib/auth/session';
import { QuestionsRepo } from '@/lib/agents/ask';

/** The user's answer to an agent's question; the paused task resumes with it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyCsrfOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  let user;
  try {
    user = await requireUser(req, new DbRepo());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  const parsed = z.object({ answer: z.string().trim().min(1).max(4000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'answer is required' }, { status: 400 });
  const { id } = await params;
  const ok = await new QuestionsRepo().answer(user.id, id, parsed.data.answer);
  return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
}
