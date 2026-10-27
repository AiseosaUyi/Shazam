import { NextRequest, NextResponse } from 'next/server';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  const { id: taskId } = await params;
  const task = await repo.getTask(user.id, taskId);

  if (!task) {
    return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      function sendEvent(event: string, data: any) {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // ignore
        }
      }

      sendEvent('task_created', {
        taskId: task.id,
        conversationId: task.conversationId,
        prompt: task.prompt,
        taskClass: task.taskClass,
        costPolicy: task.costPolicy,
      });

      if (task.decisionTrace) {
        sendEvent('route_selected', {
          routeId: task.routeId,
          modelId: task.modelId,
          providerId: task.providerId,
          decisionTrace: task.decisionTrace,
        });
      }

      // Replay attempts/fallbacks
      if (Array.isArray(task.attempts)) {
        for (let i = 0; i < task.attempts.length - 1; i++) {
          const att = task.attempts[i];
          if (att.state === 'failed') {
            sendEvent('fallback', {
              previousRouteId: att.routeId,
              attempt: att.attempt,
              reason: att.error?.message || 'Retryable failure',
            });
          }
        }
      }

      if (task.reasoning) {
        sendEvent('reasoning', { text: task.reasoning });
      }

      if (task.response) {
        sendEvent('delta', { text: task.response });
      }

      if (task.status === 'succeeded') {
        sendEvent('done', {
          taskId: task.id,
          fullText: task.response,
          reasoning: task.reasoning,
          costUSD: task.costUSD,
          costKind: task.costKind,
        });
      } else if (task.status === 'failed') {
        sendEvent('error', {
          message: task.error?.message || 'Task execution failed.',
        });
      } else if (task.status === 'cancelled') {
        sendEvent('error', { message: 'Task cancelled by user.' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
