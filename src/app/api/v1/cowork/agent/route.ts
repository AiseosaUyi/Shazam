import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { syncVaultFromCookie } from '@/lib/crypto/vault-cookie';
import { deriveConversationTitle } from '@/lib/execution/orchestrator';
import { runCoworkTask } from '@/lib/runs/execute';
import { errMessage } from '@/lib/errors';

export const maxDuration = 300;

const Schema = z.object({
  prompt: z.string().min(1).max(20000),
  conversationId: z.string().max(64).optional(),
  timezone: z.string().max(64).optional(),
  pinnedModel: z.string().max(120).optional(),
});

function validTimezone(tz?: string): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
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
  await syncVaultFromCookie(req, user.id, repo, user.email);

  // Rate limit by user: 30 cowork agent calls per minute
  const { allowed } = await repo.checkRateLimit(`cowork-agent:${user.id}`, 60, 30);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment before sending more requests.' },
      { status: 429 }
    );
  }

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const { prompt, pinnedModel } = parsed.data;
  const timezone = validTimezone(parsed.data.timezone);

  // Conversation persistence (Co-Work threads live alongside chat history).
  let conversationId = parsed.data.conversationId;
  const existing = conversationId ? await repo.getConversation(user.id, conversationId) : null;
  if (!existing) {
    conversationId = conversationId || crypto.randomUUID();
    await repo.createConversation(user.id, conversationId, deriveConversationTitle(prompt), undefined);
  }
  const prior = existing ? await repo.getMessages(user.id, conversationId!) : [];
  const history = prior
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .slice(-16)
    .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 8000) }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client went away
        }
      };
      send('cowork_start', { conversationId });

      try {
        await repo.addMessage({ id: crypto.randomUUID(), userId: user.id, conversationId: conversationId!, role: 'user', content: prompt });
        const result = await runCoworkTask({ user, prompt, history, timezone, pinnedModel, localStepTimeoutMs: 100_000, signal: req.signal, onEvent: send });

        await repo.addMessage({ id: crypto.randomUUID(), userId: user.id, conversationId: conversationId!, role: 'assistant', content: result.text || '(no reply)' });
        await repo.touchConversation(user.id, conversationId!);
        send('cowork_done', { conversationId, text: result.text, steps: result.steps });
      } catch (err) {
        send('cowork_error', { message: errMessage(err) || 'Co-Work agent failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
