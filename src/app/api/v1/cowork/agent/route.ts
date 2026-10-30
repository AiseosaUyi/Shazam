import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { requireUser } from '@/lib/auth/session';
import { syncVaultFromCookie } from '@/lib/crypto/vault-cookie';
import { resolveAgentRoute } from '@/lib/agent/resolve';
import { createLanguageModel } from '@/lib/agent/models';
import { runCoworkAgent } from '@/lib/cowork/agent';
import { buildMcpToolset } from '@/lib/mcp/tools';
import { buildSkillTools } from '@/lib/skills';
import { buildMediaTools } from '@/lib/media/tools';
import { deriveConversationTitle } from '@/lib/execution/orchestrator';

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
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
  await syncVaultFromCookie(req, user.id, repo, user.email);

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const { prompt, pinnedModel } = parsed.data;
  const timezone = validTimezone(parsed.data.timezone);
  const platform = new PlatformRepo();

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
        const route = await resolveAgentRoute(user, repo, prompt, 'planning', pinnedModel);
        const { model, modelId } = await createLanguageModel(route.selectedRoute.providerId, route.selectedModel.providerModelId, route.apiKey);
        send('react_model', { model: route.selectedModel.name, provider: route.selectedRoute.providerId, providerModelId: modelId });

        const google = await platform.getOAuth(user.id, 'google');
        const mcp = await buildMcpToolset(repo, user.id, { platform, onPendingAction: (a) => send('pending_action', a) });
        const skills = await buildSkillTools(platform, user.id, 'cowork');
        const media = await buildMediaTools(user.id, repo, platform, { enhancer: model, onAsset: (a) => send('media_asset', a) });

        await repo.addMessage({ id: crypto.randomUUID(), userId: user.id, conversationId: conversationId!, role: 'user', content: prompt });

        const result = await runCoworkAgent({
          model,
          userId: user.id,
          prompt,
          history,
          timezone,
          platform,
          googleConnected: Boolean(google),
          googleEmail: google?.accountEmail,
          extraTools: { ...mcp.tools, ...skills.tools, ...media.tools },
          extraInstructions: [mcp.inventory, skills.inventory, media.inventory].filter(Boolean).join('\n\n'),
          signal: req.signal,
          onEvent: send,
        });

        await repo.addMessage({ id: crypto.randomUUID(), userId: user.id, conversationId: conversationId!, role: 'assistant', content: result.text || '(no reply)' });
        await repo.touchConversation(user.id, conversationId!);
        send('cowork_done', { conversationId, text: result.text, steps: result.steps });
      } catch (err: any) {
        send('cowork_error', { message: err.message || 'Co-Work agent failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
