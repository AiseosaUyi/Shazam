import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { syncVaultFromCookie } from '@/lib/crypto/vault-cookie';
import { runTaskOrchestrator } from '@/lib/execution/orchestrator';
import type { CostPolicy, TaskClass } from '@/lib/types';

const CreateTaskSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(1_000_000, 'Prompt exceeds 1MB limit'),
  conversationId: z.string().optional(),
  projectId: z.string().optional(),
  costPolicy: z
    .enum(['free_only', 'lowest_cost', 'balanced', 'best_quality', 'manual_pin'])
    .optional(),
  taskClassOverride: z
    .enum([
      'writing',
      'general_chat',
      'reasoning',
      'planning',
      'coding',
      'document_analysis',
      'vision',
      'image_generation',
      'video_generation',
      'audio',
    ])
    .optional(),
  pinnedModelName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  // Hydrate user credentials from vault cookie if needed across serverless containers
  await syncVaultFromCookie(req, user.id, repo);

  // Rate limit by user: 20 task dispatches per minute
  const allowed = await repo.checkRateLimit(`tasks:${user.id}`, 20, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment before sending more requests.' },
      { status: 429 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const parseResult = CreateTaskSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues[0]?.message || 'Invalid parameters.' },
      { status: 400 }
    );
  }

  const { prompt, conversationId, projectId, costPolicy, taskClassOverride, pinnedModelName } = parseResult.data;

  // Single SSE stream response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: string, data: any) {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream might be closed by client
        }
      }

      try {
        await runTaskOrchestrator({
          user,
          prompt,
          conversationId,
          projectId,
          costPolicy: costPolicy as CostPolicy | undefined,
          taskClassOverride: taskClassOverride as TaskClass | undefined,
          pinnedModelName,
          signal: req.signal,
          repo,
          onEvent: sendEvent,
        });
      } catch (err: any) {
        sendEvent('error', { message: err.message || 'Internal task failure.' });
      } finally {
        try {
          controller.close();
        } catch {
          // Ignore if already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function GET(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const tasks = await repo.listTasks(user.id, 50);
  return NextResponse.json({ tasks });
}
