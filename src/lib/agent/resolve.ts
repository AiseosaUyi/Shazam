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

/** Free platform models via Vercel AI Gateway (OIDC auth), verified to do tool calling on the free tier (2026-10-30). */
export const GATEWAY_FREE_CHAINS: Record<'coding' | 'planning' | 'writing', string[]> = {
  coding: (process.env.SHAZAM_GATEWAY_CODE_MODELS || 'alibaba/qwen3-coder-next,moonshotai/kimi-k2,zai/glm-4.6,openai/gpt-oss-120b').split(','),
  planning: (process.env.SHAZAM_GATEWAY_COWORK_MODELS || 'moonshotai/kimi-k2,openai/gpt-oss-120b,zai/glm-4.6,alibaba/qwen3.7-flash').split(','),
  writing: (process.env.SHAZAM_GATEWAY_WRITING_MODELS || 'openai/gpt-oss-120b,alibaba/qwen3.7-flash,moonshotai/kimi-k2').split(','),
};

/** Free-tier BYOK providers the user may have connected, with the best default model for each (vetted list). */
const FREE_BYOK: Record<string, string> = {
  google: 'gemini-3.8-flash',
  groq: 'qwen/qwen3.8-27b',
  cerebras: 'gpt-oss-120b',
  openrouter: 'nvidia/nemotron-3-ultra-550b-a55b:free',
};

export interface AgentModel {
  model: import('ai').LanguageModel;
  /** Human label, e.g. "Gemini 3.8 Flash (your key)" */
  label: string;
  provider: string;
  modelId: string;
  /** The ordered fail-over chain actually in use. */
  chain: string[];
}

/**
 * Builds a fail-over chain: the routed model on the user's own key (honors pins), then the
 * user's other free-tier keys, then free platform models via AI Gateway. Rate limits and
 * outages on one link fail over to the next per step, so long agent runs survive free quotas.
 */
export async function getAgentModel(user: User, repo: DbRepo, prompt: string, taskClass: 'coding' | 'planning' | 'writing', pinnedModel?: string | null, onSwitch?: (from: string, to: string, reason: string) => void): Promise<AgentModel> {
  const { createLanguageModel } = await import('./models');
  const { createFallbackModel } = await import('./fallback');
  const { gateway } = await import('ai');
  const chain: Array<{ model: any; label: string; provider: string; modelId: string }> = [];

  try {
    const resolution = await resolveAgentRoute(user, repo, prompt, taskClass, pinnedModel);
    if (resolution.selectedRoute.providerId !== 'simulation') {
      const { model, modelId } = await createLanguageModel(resolution.selectedRoute.providerId, resolution.selectedModel.providerModelId, resolution.apiKey);
      chain.push({ model, modelId, provider: resolution.selectedRoute.providerId, label: `${resolution.selectedModel.name} (your key)` });
    }
  } catch {
    // no routed BYOK model; continue with free options
  }

  if (!pinnedModel) {
    const creds = await repo.getCredentialsWithSecrets(user.id).catch(() => []);
    for (const [provider, modelId] of Object.entries(FREE_BYOK)) {
      const cred = creds.find((c) => c.providerId === provider && c.status === 'valid');
      if (!cred || chain.some((c) => c.provider === provider)) continue;
      try {
        const key = await decryptSecret(cred.encryptedKey);
        const built = await createLanguageModel(provider, modelId, key);
        chain.push({ model: built.model, modelId: built.modelId, provider, label: `${built.modelId} (your free ${provider} key)` });
      } catch {
        // skip unusable key
      }
    }
  }

  // The user's own local model (Ollama / LM Studio) via the desktop bridge: free and private.
  try {
    const { BridgeRepo } = await import('@/lib/bridge/repo');
    const { pickLocalModel, createLocalModel } = await import('./local-llm');
    const desktop = await new BridgeRepo().onlineDevice(user.id, 'desktop');
    const local = desktop ? pickLocalModel((desktop.capabilities.localModels as any[]) || []) : null;
    if (desktop && local) {
      const entry = { model: createLocalModel(user.id, desktop, local), modelId: local.id, provider: 'local', label: `${local.id} (local on ${desktop.name})` };
      if (/^local/i.test(pinnedModel || '')) chain.unshift(entry);
      else chain.push(entry);
    }
  } catch {
    // bridge unavailable
  }

  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) {
    for (const id of GATEWAY_FREE_CHAINS[taskClass]) chain.push({ model: gateway(id.trim()), modelId: id.trim(), provider: 'gateway', label: `${id.trim()} (free platform model)` });
  }

  if (chain.length === 0) throw new Error('No model available. Add a free Google AI Studio, Groq or OpenRouter key in Connections.');
  const model = createFallbackModel(chain.map((c) => ({ model: c.model, label: c.label })), onSwitch);
  return { model, label: chain[0].label, provider: chain[0].provider, modelId: chain[0].modelId, chain: chain.map((c) => c.label) };
}
