import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { callDevice, type BridgeDevice } from '@/lib/bridge/repo';

/**
 * Local LLMs (Ollama / LM Studio) on the user's own computer, reached through the desktop
 * bridge: the request is tunneled to the device, which calls its localhost model server.
 * Free, private, and works even though the server cannot reach the user's localhost.
 */

export interface LocalModel {
  server: 'ollama' | 'lmstudio';
  id: string;
}

/** Best tool-capable local models first (vetted 2026-10). */
const PREFERRED = [/qwen3\.8/, /qwen3-coder/, /gpt-oss/, /gemma4/, /qwen3/, /llama3\.3/, /mistral|devstral/];

export function pickLocalModel(models: LocalModel[]): LocalModel | null {
  if (!models.length) return null;
  for (const rx of PREFERRED) {
    const m = models.find((x) => rx.test(x.id.toLowerCase()) && !/embed/.test(x.id));
    if (m) return m;
  }
  return models.find((m) => !/embed/.test(m.id)) || null;
}

export function createLocalModel(userId: string, device: BridgeDevice, model: LocalModel) {
  const servers = (device.capabilities.localServers as Array<{ name: string; base: string }>) || [];
  const base = servers.find((s) => s.name === model.server)?.base || (model.server === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234');

  const tunnelFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const target = `${base}${new URL(url).pathname}`;
    const out = await callDevice(userId, 'desktop', 'llm_http', { url: target, method: init?.method || 'POST', body: typeof init?.body === 'string' ? init.body : undefined }, { timeoutMs: 300_000, signal: init?.signal || undefined });
    if (!out.ok) return new Response(JSON.stringify({ error: { message: String(out.result) } }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    return new Response(out.result.body, { status: out.result.status, headers: { 'Content-Type': out.result.contentType } });
  };

  return createOpenAICompatible({ name: `local-${model.server}`, baseURL: 'http://local-llm/v1', fetch: tunnelFetch })(model.id);
}
