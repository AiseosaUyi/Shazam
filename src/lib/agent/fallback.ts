import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';

/**
 * A model that fails over across a chain of models on rate limits, quota and outages.
 * Free tiers are tight (e.g. 5 requests/min), and a 40-step agent run must not die on
 * step 12. Fail-over happens per step, before any output of that step is emitted, so the
 * agent loop continues seamlessly on the next model. Cooled-down models are skipped.
 */

const cooldownUntil = new Map<string, number>();

export function isRetryableModelError(err: unknown): boolean {
  const e = err as any;
  const status = e?.statusCode ?? e?.status ?? e?.cause?.statusCode;
  const msg = `${e?.message || ''} ${e?.responseBody || ''} ${e?.name || ''}`;
  return status === 429 || status === 402 || (typeof status === 'number' && status >= 500) ||
    /rate.?limit|quota|RESOURCE_EXHAUSTED|overloaded|temporarily unavailable|capacity|high demand|Free tier users do not have access|insufficient|too many requests|timed? ?out|ETIMEDOUT/i.test(msg);
}

const strikes = new Map<string, number>();
const MIN = 60_000;

/**
 * How long to rest a model after a limit error. Uses the provider's own "try again in" hint,
 * rests much longer when the request can't fit the model's per-minute budget or a daily quota
 * is spent (retrying in a minute would just fail again), and backs off further on each repeat
 * so one tight free tier (Groq's is a few thousand tokens/min) can't stall a long run.
 */
export function cooldownMs(err: unknown, strike = 1): number {
  const e = err as any;
  const msg = `${e?.message || ''} ${e?.responseBody || ''}`;
  if (/request too large|tokens per day|requests per day|\bTPD\b|\bRPD\b|per day|daily/i.test(msg) || e?.statusCode === 413) return 30 * MIN;
  let hinted = 0;
  const header = Number(e?.responseHeaders?.['retry-after']);
  if (header > 0) hinted = header * 1000;
  const after = msg.match(/retry after (\d+(?:\.\d+)?)\s*s/i);
  if (after) hinted = Number(after[1]) * 1000;
  const again = msg.match(/try again in (?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?/i);
  if (again && again[0].length > 'try again in '.length) {
    hinted = (Number(again[1] || 0) * 3600 + Number(again[2] || 0) * 60 + Number(again[3] || 0)) * 1000 + Number(again[4] || 0);
  }
  const backoff = Math.min(15 * MIN, MIN * 2 ** Math.max(0, strike - 1));
  return Math.max(hinted, backoff);
}

/**
 * A step that moved to another provider carries the previous model's reasoning in its history,
 * which some providers refuse (Groq: "property 'reasoning_content' is unsupported").
 */
export function rejectsReasoning(err: unknown): boolean {
  const e = err as any;
  const msg = `${e?.message || ''} ${e?.responseBody || ''}`;
  return /reasoning_content|reasoning[^.]{0,40}(unsupported|not supported|not allowed|unknown|invalid)|thinking[^.]{0,40}(unsupported|not supported)/i.test(msg);
}

/** Removes reasoning parts from earlier assistant turns (the answer and tool calls stay). */
export function stripReasoning(options: LanguageModelV4CallOptions): LanguageModelV4CallOptions {
  const prompt = options.prompt
    .map((msg: any) => (msg.role === 'assistant' && Array.isArray(msg.content) ? { ...msg, content: msg.content.filter((p: any) => p.type !== 'reasoning' && p.type !== 'reasoning-file') } : msg))
    .filter((msg: any) => !(msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.length === 0));
  return { ...options, prompt };
}

function isAbort(err: unknown): boolean {
  const e = err as any;
  return e?.name === 'AbortError' || /Task cancelled by user|aborted by the user/i.test(String(e?.message || ''));
}

/** An HTTP 4xx from a model provider: specific to that provider or request, not to the whole chain. */
export function isProviderRequestError(err: unknown): boolean {
  const e = err as any;
  const status = e?.statusCode ?? e?.status ?? e?.cause?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export interface ChainEntry {
  model: LanguageModelV4;
  label: string;
}

export function createFallbackModel(chain: ChainEntry[], onSwitch?: (from: string, to: string, reason: string) => void): LanguageModelV4 {
  if (chain.length === 1) return chain[0].model;
  const key = (c: ChainEntry) => `${c.model.provider}:${c.model.modelId}`;

  const ordered = () => {
    const now = Date.now();
    const ready = chain.filter((c) => (cooldownUntil.get(key(c)) || 0) <= now);
    return ready.length ? ready : [...chain].sort((a, b) => (cooldownUntil.get(key(a)) || 0) - (cooldownUntil.get(key(b)) || 0));
  };

  async function attempt<T>(run: (m: LanguageModelV4) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    // The first request-specific error, reported if every model fails: it explains the problem
    // better than whatever the last fallback said.
    let firstRequestErr: unknown;
    const candidates = ordered();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      try {
        const out = await run(c.model);
        strikes.delete(key(c));
        return out;
      } catch (err) {
        lastErr = err;
        if (isAbort(err)) throw err;
        const next = candidates[i + 1];
        if (isRetryableModelError(err) || (err as any)?.statusCode === 413) {
          const strike = (strikes.get(key(c)) || 0) + 1;
          strikes.set(key(c), strike);
          cooldownUntil.set(key(c), Date.now() + cooldownMs(err, strike));
        } else if (isProviderRequestError(err)) {
          // A 4xx one provider rejects (tool schema, message format, model gone) often works on
          // another: try the next model without resting this one.
          firstRequestErr ??= err;
        } else {
          throw firstRequestErr ?? err;
        }
        if (next) onSwitch?.(c.label, next.label, String((err as any)?.message || err).slice(0, 160));
      }
    }
    throw firstRequestErr ?? lastErr;
  }

  /** Calls one model; if it rejects earlier models' reasoning in the history, retries it without. */
  const withReasoningRetry = async <T>(m: LanguageModelV4, options: LanguageModelV4CallOptions, call: (m: LanguageModelV4, o: LanguageModelV4CallOptions) => Promise<T>): Promise<T> => {
    try {
      return await call(m, options);
    } catch (err) {
      if (!rejectsReasoning(err)) throw err;
      return call(m, stripReasoning(options));
    }
  };

  const streamOnce = async (m: LanguageModelV4, options: LanguageModelV4CallOptions) => {
    const result = await m.doStream(options);
    // Some providers report rate limits as the first stream part instead of throwing.
    const reader = result.stream.getReader();
    const first = await reader.read();
    if (!first.done && (first.value as LanguageModelV4StreamPart).type === 'error') {
      const err = (first.value as any).error;
      if (isRetryableModelError(err) || rejectsReasoning(err)) {
        reader.releaseLock();
        throw err;
      }
    }
    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        if (!first.done) controller.enqueue(first.value);
        else controller.close();
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return { ...result, stream };
  };

  const primary = chain[0].model;
  return {
    specificationVersion: 'v4',
    provider: 'shazam-fallback',
    modelId: chain.map((c) => c.model.modelId).join(' → '),
    supportedUrls: primary.supportedUrls,
    doGenerate: (options: LanguageModelV4CallOptions) => attempt((m) => withReasoningRetry(m, options, (mm, o) => Promise.resolve(mm.doGenerate(o)))),
    doStream: (options: LanguageModelV4CallOptions) => attempt((m) => withReasoningRetry(m, options, streamOnce)),
  };
}
