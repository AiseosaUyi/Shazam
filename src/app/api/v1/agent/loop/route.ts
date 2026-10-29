import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { syncVaultFromCookie } from '@/lib/crypto/vault-cookie';
import { executeReActLoop } from '@/lib/agent/react_engine';
import { resolveTaskRoute } from '@/lib/routing/router';
import { classifyTask } from '@/lib/routing/classifier';
import { dispatchExecution } from '@/lib/execution/dispatcher';
import { envFlag, envVar } from '@/lib/env';
import { decryptSecret } from '@/lib/crypto/vault';

const ReActTaskSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  projectId: z.string().optional(),
  daemonToken: z.string().optional(),
  daemonPort: z.string().optional(),
  maxTurns: z.number().min(1).max(12).optional(),
});

export async function POST(req: NextRequest) {
  const repo = new DbRepo();
  let user;
  try {
    user = await requireUser(req, repo);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }

  await syncVaultFromCookie(req, user.id, repo, user.email);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ReActTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid parameters' }, { status: 400 });
  }

  const { prompt, projectId, daemonToken, daemonPort = '4040', maxTurns = 6 } = parsed.data;

  // Fetch project files if projectId provided
  let projectFiles: Array<{ path: string; content: string }> = [];
  let projectName = 'Project';

  if (projectId) {
    const proj = await repo.getProject(user.id, projectId);
    if (proj) {
      projectName = proj.name;
      const files = await repo.getProjectFiles(user.id, projectId);
      projectFiles = files.map((f) => ({ path: f.path, content: f.content }));
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(event: string, data: any) {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Closed by client
        }
      }

      sendEvent('react_start', { prompt, projectName, fileCount: projectFiles.length });

      // Create model invoker via Shazam Router
      const invokeLLM = async (messages: Array<{ role: string; content: string }>): Promise<string> => {
        const lastMsg = messages[messages.length - 1];
        const taskSpec = classifyTask(lastMsg.content, { taskClassOverride: 'coding' });
        const resolution = await resolveTaskRoute(taskSpec, user, repo);

        let apiKey = '';
        if (resolution.selectedProvider.requiresApiKey) {
          const userCred = await repo.getCredential(user.id, resolution.selectedRoute.providerId);
          if (userCred && userCred.status === 'valid') {
            apiKey = await decryptSecret(userCred.encryptedKey);
          } else {
            const canUseSystemKeys = user.role === 'admin' || envFlag('SHAZAM_SHARE_SYSTEM_KEYS', false);
            if (canUseSystemKeys) {
              if (resolution.selectedRoute.providerId === 'google') {
                apiKey = envVar('GOOGLE_AI_API_KEY') || envVar('GOOGLE_API_KEY') || '';
              } else if (resolution.selectedRoute.providerId === 'openai') {
                apiKey = envVar('OPENAI_API_KEY') || '';
              } else if (resolution.selectedRoute.providerId === 'anthropic') {
                apiKey = envVar('ANTHROPIC_API_KEY') || '';
              } else if (resolution.selectedRoute.providerId === 'deepseek') {
                apiKey = envVar('DEEPSEEK_API_KEY') || '';
              } else if (resolution.selectedRoute.providerId === 'openrouter') {
                apiKey = envVar('OPENROUTER_API_KEY') || '';
              }
            }
          }
        } else {
          apiKey = 'free_tier';
        }

        const history = messages
          .slice(1, -1)
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            id: crypto.randomUUID(),
            taskId: 'react_turn',
            role: m.role as 'user' | 'assistant',
            content: m.content,
            createdAt: new Date().toISOString(),
          }));

        let responseText = '';
        await dispatchExecution({
          model: resolution.selectedModel,
          route: resolution.selectedRoute,
          prompt: lastMsg.content,
          history,
          apiKey,
          onChunk: (chunk) => {
            if (chunk.type === 'delta') {
              responseText += chunk.text;
            }
          },
        });

        return responseText;
      };

      try {
        const daemonUrl = daemonToken ? `http://localhost:${daemonPort}` : undefined;
        const result = await executeReActLoop(prompt, {
          projectName,
          files: projectFiles,
          daemonUrl,
          daemonToken,
          maxTurns,
          onEvent: (ev, data) => sendEvent(ev, data),
          invokeLLM,
        });

        // Persist modified files back to project
        if (projectId && result.filesModified.length > 0) {
          for (const modPath of result.filesModified) {
            const found = projectFiles.find((f) => f.path.toLowerCase() === modPath.toLowerCase());
            if (found) {
              await repo.putProjectFile(user.id, projectId, found.path, found.content);
            }
          }
        }

        sendEvent('react_done', {
          success: result.success,
          filesModified: result.filesModified,
          finalSummary: result.finalSummary,
          stepsCount: result.steps.length,
        });
      } catch (err: any) {
        sendEvent('react_error', { message: err.message || 'Error executing autonomous loop' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
