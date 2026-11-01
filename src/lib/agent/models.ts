import { gateway, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * AI SDK model factory for BYOK providers, with live model discovery.
 *
 * Hardcoded provider model IDs go stale (the old resolver still mapped to retired
 * claude-3-5 / gpt-4o IDs), so we ask each provider which models this key can use
 * and pick the best match for the catalog entry.
 */

const discoveryCache = new Map<string, { at: number; ids: string[] }>();
const DISCOVERY_TTL_MS = 30 * 60 * 1000;

async function listProviderModels(providerId: string, apiKey: string): Promise<string[]> {
  const cacheKey = `${providerId}:${apiKey.slice(-8)}`;
  const hit = discoveryCache.get(cacheKey);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.ids;

  let ids: string[] = [];
  try {
    if (providerId === 'google') {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(8000),
      });
      const data: any = await res.json();
      ids = (data.models || [])
        .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m: any) => String(m.name).replace(/^models\//, ''));
    } else if (providerId === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(8000),
      });
      const data: any = await res.json();
      ids = (data.data || []).map((m: any) => m.id);
    } else {
      const base = OPENAI_COMPATIBLE_BASES[providerId];
      if (base) {
        const res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000),
        });
        const data: any = await res.json();
        ids = (data.data || []).map((m: any) => m.id);
      }
    }
  } catch {
    ids = [];
  }
  if (ids.length > 0) discoveryCache.set(cacheKey, { at: Date.now(), ids });
  return ids;
}

const OPENAI_COMPATIBLE_BASES: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
};

/** Preference order when the exact catalog ID is not offered to this key. */
const PREFERENCES: Record<string, RegExp[]> = {
  google: [/^gemini-[\d.]+-pro(?!.*(image|tts|embedding|live))/, /^gemini-[\d.]+-flash(?!.*(image|tts|embedding|live|lite))/, /^gemini-[\d.]+-flash-lite/],
  anthropic: [/sonnet/, /opus/, /haiku/],
  openai: [/^gpt-[\d.]+(?!.*(mini|nano|audio|realtime|image|search|transcribe|tts))/, /^gpt-[\d.]+-mini/, /^o\d/],
  deepseek: [/deepseek-chat/, /deepseek/],
  openrouter: [/nemotron-3-ultra.*:free$/, /gemma-4-31b.*:free$/, /:free$/],
  groq: [/qwen3\.8/, /gpt-oss-120b/, /gpt-oss/],
  cerebras: [/gpt-oss-120b/, /qwen-?3\.8/, /qwen/],
};

/** Verifies a pasted key against the provider before it is saved. */
export async function checkProviderKey(providerId: string, apiKey: string): Promise<{ ok: boolean; models: number; error?: string }> {
  const urls: Record<string, { url: string; headers: Record<string, string> }> = {
    google: { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=5', headers: { 'x-goog-api-key': apiKey } },
    anthropic: { url: 'https://api.anthropic.com/v1/models?limit=5', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } },
    ...Object.fromEntries(Object.entries(OPENAI_COMPATIBLE_BASES).map(([k, base]) => [k, { url: `${base}/models`, headers: { Authorization: `Bearer ${apiKey}` } }])),
    // OpenRouter's /models is public (200 for any key), so validate against /key instead.
    openrouter: { url: 'https://openrouter.ai/api/v1/key', headers: { Authorization: `Bearer ${apiKey}` } },
    github: { url: 'https://api.github.com/user', headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'shazam-ai' } },
  };
  const target = urls[providerId];
  if (!target) return { ok: true, models: 0 };
  try {
    const res = await fetch(target.url, { headers: target.headers, signal: AbortSignal.timeout(8000) });
    const rejected = { ok: false, models: 0, error: 'The provider rejected this key. Check you copied all of it.' };
    if (res.status === 401 || res.status === 403) return rejected;
    if (res.status === 400) {
      // Google answers an invalid key with 400 API_KEY_INVALID, not 401.
      const body = await res.text().catch(() => '');
      if (/API_KEY_INVALID|API key not valid|invalid.{0,10}(api.)?key/i.test(body)) return rejected;
    }
    if (!res.ok) return { ok: true, models: 0 }; // provider hiccup: don't block saving
    const data: any = await res.json().catch(() => ({}));
    return { ok: true, models: (data.models || data.data || []).length };
  } catch {
    return { ok: true, models: 0 };
  }
}

export async function resolveLiveModelId(providerId: string, catalogModelId: string, apiKey: string): Promise<string> {
  const ids = await listProviderModels(providerId, apiKey);
  if (ids.length === 0) return catalogModelId;
  if (ids.includes(catalogModelId)) return catalogModelId;

  // Same family name (e.g. catalog "claude-sonnet-5.5" vs live "claude-sonnet-5-5").
  const normalized = catalogModelId.replace(/\./g, '-').toLowerCase();
  const family = ids.find((id) => id.toLowerCase().replace(/\./g, '-').startsWith(normalized));
  if (family) return family;

  for (const pattern of PREFERENCES[providerId] || []) {
    const match = ids
      .filter((id) => pattern.test(id) && !/preview-\d{2}-\d{2}|exp/.test(id))
      .sort()
      .reverse()[0];
    if (match) return match;
  }
  return ids[0];
}

export async function createLanguageModel(providerId: string, catalogModelId: string, apiKey: string): Promise<{ model: LanguageModel; modelId: string }> {
  if (providerId === 'gateway') return { model: gateway(catalogModelId), modelId: catalogModelId };
  const modelId = providerId === 'ollama' ? catalogModelId : await resolveLiveModelId(providerId, catalogModelId, apiKey);

  switch (providerId) {
    case 'google':
      return { model: createGoogleGenerativeAI({ apiKey })(modelId), modelId };
    case 'anthropic':
      return { model: createAnthropic({ apiKey })(modelId), modelId };
    case 'openai':
      return { model: createOpenAI({ apiKey })(modelId), modelId };
    case 'deepseek':
    case 'openrouter':
    case 'groq':
    case 'cerebras':
      return {
        model: createOpenAICompatible({
          name: providerId,
          baseURL: OPENAI_COMPATIBLE_BASES[providerId],
          apiKey,
          headers: providerId === 'openrouter' ? { 'HTTP-Referer': 'https://arcwork-ai.vercel.app', 'X-Title': 'Arcwork' } : undefined,
        })(modelId),
        modelId,
      };
    case 'ollama':
      return {
        model: createOpenAICompatible({ name: 'ollama', baseURL: `${process.env.OLLAMA_HOST || 'http://localhost:11434'}/v1` })(modelId),
        modelId,
      };
    default:
      throw new Error(`Provider "${providerId}" does not support the coding agent yet.`);
  }
}
