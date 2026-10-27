import { NextRequest } from 'next/server';
import { taskEventHub } from '@/lib/task/orchestrator';
import { db } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (eventType: string, data: any) => {
        const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      // Check current task status
      const existingTask = await db.getTaskById(taskId);
      if (existingTask) {
        sendEvent('state_snapshot', existingTask);
        if (existingTask.status === 'succeeded' || existingTask.status === 'failed') {
          controller.close();
          return;
        }
      }

      // Subscribe to live events
      const unsubscribe = taskEventHub.subscribe(taskId, (event) => {
        sendEvent(event.type, event.data);
        if (event.type === 'task_succeeded' || event.type === 'task_failed' || event.type === 'task_cancelled') {
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // ignore if already closed
            }
          }, 100);
        }
      });

      req.signal.addEventListener('abort', () => {
        unsubscribe();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
