import { streamText, gateway } from 'ai';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { normalizeProviderError } from './error';
import { SHAZAM_SYSTEM_IDENTITY } from '../system-prompt';

/** Free platform models through Vercel AI Gateway (OIDC auth, no user key). */
export async function executeGateway(options: ExecuteOptions): Promise<AdapterResult> {
  const { model, prompt, history = [], signal, onChunk } = options;
  try {
    const result = streamText({
      model: gateway(model.providerModelId),
      instructions: options.systemPrompt ?? SHAZAM_SYSTEM_IDENTITY,
      messages: [...history.map((h) => ({ role: h.role, content: h.content })), { role: 'user' as const, content: prompt }],
      abortSignal: signal,
    });
    let fullText = '';
    for await (const delta of result.textStream) {
      fullText += delta;
      onChunk({ type: 'delta', text: delta });
    }
    const usage = await result.usage;
    return {
      fullText,
      usage: { promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0, tokensKind: 'provider_reported' },
      costUSD: 0,
      costKind: 'zero',
    };
  } catch (err) {
    if (signal?.aborted) throw new Error('Task cancelled');
    throw normalizeProviderError('Shazam free models', err as any, (err as any)?.statusCode);
  }
}
