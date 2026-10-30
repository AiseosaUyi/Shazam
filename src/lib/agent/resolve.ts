import type { User, TaskClass } from '@/lib/types';
import type { DbRepo } from '@/lib/db/repo';
import { resolveTaskRoute } from '@/lib/routing/router';
import { classifyTask } from '@/lib/routing/classifier';
import { decryptSecret } from '@/lib/crypto/vault';
import { envFlag, envVar } from '@/lib/env';

export type AgentResolution = Awaited<ReturnType<typeof resolveTaskRoute>> & { apiKey: string };

/** Picks one route for a whole agent run and loads the matching API key (BYOK first). */
export async function resolveAgentRoute(
  user: User,
  repo: DbRepo,
  prompt: string,
  taskClass: TaskClass,
  pinnedModel?: string | null
): Promise<AgentResolution> {
  const resolution = await resolveTaskRoute(classifyTask(prompt, { taskClassOverride: taskClass, pinnedRouteId: pinnedModel || null }), user, repo);
  let apiKey = '';
  if (resolution.selectedProvider.requiresApiKey) {
    const userCred = await repo.getCredential(user.id, resolution.selectedRoute.providerId);
    if (userCred && userCred.status === 'valid') {
      apiKey = await decryptSecret(userCred.encryptedKey);
    } else if (user.role === 'admin' || envFlag('SHAZAM_SHARE_SYSTEM_KEYS', false)) {
      const systemKeys: Record<string, string | undefined> = {
        google: envVar('GOOGLE_AI_API_KEY') || envVar('GOOGLE_API_KEY'),
        openai: envVar('OPENAI_API_KEY'),
        anthropic: envVar('ANTHROPIC_API_KEY'),
        deepseek: envVar('DEEPSEEK_API_KEY'),
        openrouter: envVar('OPENROUTER_API_KEY'),
      };
      apiKey = systemKeys[resolution.selectedRoute.providerId] || '';
    }
    if (!apiKey) {
      throw new Error(`No API key for ${resolution.selectedProvider.name}. Add a key in Connections (a free Google AI Studio or OpenRouter key works).`);
    }
  } else {
    apiKey = 'free_tier';
  }
  return { ...resolution, apiKey };
}
