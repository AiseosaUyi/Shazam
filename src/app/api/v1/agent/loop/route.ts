import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { requireUser } from '@/lib/auth/session';
import { syncVaultFromCookie } from '@/lib/crypto/vault-cookie';
import { executeReActLoop } from '@/lib/agent/react_engine';
import { runToolAgent } from '@/lib/agent/tool_agent';
import { createLanguageModel } from '@/lib/agent/models';
import { ProjectSandbox, sandboxAvailable } from '@/lib/agent/sandbox';
import { buildMcpToolset } from '@/lib/mcp/tools';
import { resolveAgentRoute, type AgentResolution } from '@/lib/agent/resolve';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { buildSkillTools } from '@/lib/skills';

export const maxDuration = 300;
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
  maxTurns: z.number().min(1).max(60).optional(),
  allowExternalWrites: z.boolean().optional(),
  pinnedModel: z.string().max(120).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(40).optional(),
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

  const { prompt, projectId, daemonToken, daemonPort = '4040', maxTurns = 40, allowExternalWrites = false, history = [], pinnedModel } = parsed.data;

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

      // Resolve the route ONCE so the whole loop runs on the same model. Re-routing every
      // turn let the classifier hop between providers mid-task and lose the tool protocol.
      let resolution: AgentResolution;
      let apiKey = '';
      try {
        resolution = await resolveAgentRoute(user, repo, prompt, 'coding', pinnedModel);
        apiKey = resolution.apiKey;
      } catch (err: any) {
        sendEvent('react_error', { message: err.message || 'No eligible model for coding tasks.' });
        controller.close();
        return;
      }
      sendEvent('react_model', { model: resolution.selectedModel.name, provider: resolution.selectedRoute.providerId });

      const invokeLLM = async (messages: Array<{ role: string; content: string }>): Promise<string> => {
        const systemPrompt = messages[0]?.role === 'system' ? messages[0].content : undefined;
        const lastMsg = messages[messages.length - 1];
        const history = messages
          .slice(systemPrompt ? 1 : 0, -1)
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
          systemPrompt,
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
        let result: { success: boolean; filesModified: string[]; filesDeleted?: string[]; finalSummary: string; stepsCount: number; commandsRun?: Array<{ command: string; exitCode: number }> };

        if (resolution.selectedModel.supportsTools !== false && resolution.selectedRoute.providerId !== 'simulation') {
          // Native tool calling (default path).
          const { model, modelId } = await createLanguageModel(resolution.selectedRoute.providerId, resolution.selectedModel.providerModelId, apiKey);
          sendEvent('react_model', { model: resolution.selectedModel.name, provider: resolution.selectedRoute.providerId, providerModelId: modelId, mode: 'native-tools' });

          const sandbox = sandboxAvailable() ? new ProjectSandbox(user.id, projectId || 'scratch') : null;
          sendEvent('react_execution', { backend: sandbox ? 'vercel-sandbox' : 'none' });
          const platform = new PlatformRepo();
          const mcp = await buildMcpToolset(repo, user.id, {
            allowMutations: allowExternalWrites,
            platform,
            onPendingAction: (a) => sendEvent('pending_action', a),
          });
          const skills = await buildSkillTools(platform, user.id, 'code');

          const out = await runToolAgent({
            model,
            prompt,
            history: history.map((h) => ({ role: h.role, content: h.content })),
            projectName,
            files: projectFiles,
            sandbox,
            extraTools: { ...mcp.tools, ...skills.tools },
            extraInstructions: [mcp.inventory, skills.inventory].filter(Boolean).join('\n\n'),
            maxSteps: maxTurns,
            signal: req.signal,
            onEvent: (ev, data) => sendEvent(ev, data),
          });
          result = {
            success: true,
            filesModified: out.filesModified,
            filesDeleted: out.filesDeleted,
            finalSummary: out.text || 'Done.',
            stepsCount: out.steps,
            commandsRun: out.commandsRun,
          };
        } else {
          // Text-protocol fallback for models without function calling.
          sendEvent('react_model', { model: resolution.selectedModel.name, provider: resolution.selectedRoute.providerId, mode: 'text-protocol' });
          const legacy = await executeReActLoop(prompt, {
            projectName,
            files: projectFiles,
            daemonUrl,
            daemonToken,
            maxTurns,
            onEvent: (ev, data) => sendEvent(ev, data),
            invokeLLM,
          });
          result = { ...legacy, stepsCount: legacy.steps.length };
        }

        // Persist modified files back to project
        if (projectId) {
          for (const modPath of result.filesModified) {
            const found = projectFiles.find((f) => f.path.toLowerCase() === modPath.toLowerCase());
            if (found) await repo.putProjectFile(user.id, projectId, found.path, found.content);
          }
          for (const delPath of result.filesDeleted || []) {
            await repo.deleteProjectFile(user.id, projectId, delPath);
          }
        }

        sendEvent('react_done', {
          success: result.success,
          filesModified: result.filesModified,
          filesDeleted: result.filesDeleted || [],
          finalSummary: result.finalSummary,
          stepsCount: result.stepsCount,
          commandsRun: result.commandsRun || [],
          files: projectId ? undefined : projectFiles.filter((f) => result.filesModified.includes(f.path)),
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
