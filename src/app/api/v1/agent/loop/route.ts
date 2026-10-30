import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { syncVaultFromCookie } from '@/lib/crypto/vault-cookie';
import { runCodeTask } from '@/lib/runs/execute';

export const maxDuration = 300;

const Schema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  projectId: z.string().optional(),
  maxTurns: z.number().min(1).max(60).optional(),
  allowExternalWrites: z.boolean().optional(),
  pinnedModel: z.string().max(120).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(40).optional(),
});

/** Streams a Code agent run (native tool calling, real sandbox) as server-sent events. */
export async function POST(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  await syncVaultFromCookie(req, user.id, repo, user.email);

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid parameters' }, { status: 400 });
  const { prompt, projectId, maxTurns = 40, allowExternalWrites = false, history = [], pinnedModel } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client disconnected
        }
      };
      send('react_start', { prompt });
      try {
        const out = await runCodeTask({ user, prompt, projectId, history, pinnedModel, maxSteps: maxTurns, allowExternalWrites, signal: req.signal, onEvent: send });
        send('react_done', {
          success: true,
          projectId: out.projectId,
          filesModified: out.filesModified,
          filesDeleted: out.filesDeleted,
          finalSummary: out.text,
          stepsCount: out.steps,
          commandsRun: out.commandsRun,
        });
      } catch (err: any) {
        send('react_error', { message: err.message || 'Error executing the coding agent' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
