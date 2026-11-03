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

/**
 * Best tool-capable local models first (vetted 2026-11). arcwork-* are models Arcwork set up
 * with a 64K context; a 4K default context silently drops the instructions in long runs.
 */
const PREFERRED = [/^arcwork-/, /qwen3\.6/, /qwen3\.8/, /qwen3-coder/, /qwen3\.5/, /gpt-oss/, /gemma4/, /qwen3/, /llama3\.3/, /mistral|devstral/];
/** Small models: only lead when nothing bigger is installed (8 GB laptops). */
const SMALL = /(^|[:\-_])(2|3|4)b\b|\be[24]b\b/i;
/** Too small to do agent work at all: tool calls come out as garbage, which no fallback catches. */
const TOO_SMALL = /(^|[:\-_])(0\.\d+|1|1\.\d)b\b/i;

export function pickLocalModel(models: LocalModel[]): LocalModel | null {
  const usable = models.filter((m) => !/embed/i.test(m.id) && !TOO_SMALL.test(m.id));
  const capable = usable.filter((m) => !SMALL.test(m.id));
  for (const pool of [capable, usable]) {
    for (const rx of PREFERRED) {
      const m = pool.find((x) => rx.test(x.id.toLowerCase()));
      if (m) return m;
    }
    if (pool[0]) return pool[0];
  }
  return null;
}

/** One step's budget. Thinking models usually answer in 10–110s; rare runaway thinks take 5+ min. */
export const LOCAL_STEP_TIMEOUT_MS = Number(process.env.SHAZAM_LOCAL_STEP_TIMEOUT_MS || 240_000);
/** The retry without thinking answers fast; give it less time. */
const FAST_RETRY_MS = 90_000;
/** Bounds a runaway think while leaving room for long file writes. */
export const LOCAL_MAX_OUTPUT_TOKENS = 16_384;

export type LocalThinking = 'on' | 'off';

/**
 * Applies Arcwork's local defaults to an OpenAI-compatible request body. Local models are free,
 * so thinking is on for the best answers (Ollama: reasoning_effort, "none" turns it off), and
 * output is capped so one step cannot think forever.
 */
export function withLocalDefaults(body: string | undefined, thinking: LocalThinking): string | undefined {
  if (!body) return body;
  try {
    const j = JSON.parse(body);
    if (thinking === 'off') j.reasoning_effort = 'none';
    else if (!j.reasoning_effort || j.reasoning_effort === 'none') j.reasoning_effort = 'high';
    if (!j.max_tokens && !j.max_completion_tokens) j.max_tokens = LOCAL_MAX_OUTPUT_TOKENS;
    return JSON.stringify(j);
  } catch {
    return body;
  }
}

const TIMEOUT_RX = /timed? ?out|timeout|aborted|did not respond in time/i;

export function createLocalModel(userId: string, device: BridgeDevice, model: LocalModel, opts: { stepTimeoutMs?: number } = {}) {
  const servers = (device.capabilities.localServers as Array<{ name: string; base: string }>) || [];
  const base = servers.find((s) => s.name === model.server)?.base || (model.server === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234');
  const stepTimeoutMs = opts.stepTimeoutMs ?? LOCAL_STEP_TIMEOUT_MS;

  const tunnelFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const target = `${base}${new URL(url).pathname}`;
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    const signal = init?.signal || undefined;

    const send = async (body: string | undefined, timeoutMs: number) => {
      try {
        // The computer gives up a few seconds before the server stops waiting, so Ollama stops too.
        const out = await callDevice(userId, 'desktop', 'llm_http', { url: target, method: init?.method || 'POST', body, timeoutMs: timeoutMs - 5000 }, { timeoutMs, signal });
        if (!out.ok && TIMEOUT_RX.test(String(out.result))) return { timedOut: true as const };
        return { timedOut: false as const, out };
      } catch (err: any) {
        if (signal?.aborted) throw err;
        if (TIMEOUT_RX.test(String(err?.message))) return { timedOut: true as const };
        // The computer went offline mid-run: let this step move to a cloud model (503 is retryable).
        return { timedOut: false as const, out: { ok: false, result: `local model unavailable: ${err?.message || err}`, status: 503 } };
      }
    };

    // Best answer first (thinking on); if it runs too long, answer again quickly without thinking.
    let r = await send(withLocalDefaults(raw, 'on'), stepTimeoutMs);
    if (r.timedOut) r = await send(withLocalDefaults(raw, 'off'), Math.min(FAST_RETRY_MS, stepTimeoutMs));
    // Still nothing: a 5xx makes the fallback chain move this step to the next free model.
    if (r.timedOut) return new Response(JSON.stringify({ error: { message: `local model timed out (${model.id})` } }), { status: 504, headers: { 'Content-Type': 'application/json' } });
    const { out } = r;
    if (!out.ok) return new Response(JSON.stringify({ error: { message: String(out.result) } }), { status: (out as any).status || 502, headers: { 'Content-Type': 'application/json' } });
    return new Response(out.result.body, { status: out.result.status, headers: { 'Content-Type': out.result.contentType } });
  };

  return createOpenAICompatible({ name: `local-${model.server}`, baseURL: 'http://local-llm/v1', fetch: tunnelFetch })(model.id);
}
