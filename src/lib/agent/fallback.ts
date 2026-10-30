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
    /rate.?limit|quota|RESOURCE_EXHAUSTED|overloaded|temporarily unavailable|capacity|Free tier users do not have access|insufficient|too many requests/i.test(msg);
}

function retryAfterMs(err: unknown): number {
  const m = String((err as any)?.message || '').match(/retry after (\d+)\s*s/i);
  return m ? Number(m[1]) * 1000 : 60_000;
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
    const candidates = ordered();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      try {
        return await run(c.model);
      } catch (err) {
        lastErr = err;
        if (!isRetryableModelError(err)) throw err;
        cooldownUntil.set(key(c), Date.now() + retryAfterMs(err));
        const next = candidates[i + 1];
        if (next) onSwitch?.(c.label, next.label, String((err as any)?.message || err).slice(0, 160));
      }
    }
    throw lastErr;
  }

  const primary = chain[0].model;
  return {
    specificationVersion: 'v4',
    provider: 'shazam-fallback',
    modelId: chain.map((c) => c.model.modelId).join(' → '),
    supportedUrls: primary.supportedUrls,
    doGenerate: (options: LanguageModelV4CallOptions) => attempt((m) => Promise.resolve(m.doGenerate(options))),
    doStream: (options: LanguageModelV4CallOptions) =>
      attempt(async (m) => {
        const result = await m.doStream(options);
        // Some providers report rate limits as the first stream part instead of throwing.
        const reader = result.stream.getReader();
        const first = await reader.read();
        if (!first.done && (first.value as LanguageModelV4StreamPart).type === 'error') {
          const err = (first.value as any).error;
          if (isRetryableModelError(err)) {
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
      }),
  };
}
