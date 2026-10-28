import type { ChatMessage, Model, Route, StreamChunk, Usage } from '@/lib/types';
import { normalizeProviderError } from './error';
import { resolveLiveProviderModel, createTimeoutSignal } from './model-resolver';

export interface ExecuteOptions {
  model: Model;
  route: Route;
  prompt: string;
  history?: ChatMessage[];
  apiKey: string;
  signal?: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
}

export interface AdapterResult {
  fullText: string;
  reasoning?: string;
  usage: Usage;
  costUSD: number;
  costKind: 'estimated' | 'unknown' | 'zero';
}

export async function executeOpenAICompatible(options: ExecuteOptions, endpoint: string): Promise<AdapterResult> {
  const { model, route, prompt, history = [], apiKey, signal, onChunk } = options;

  const messages: any[] = [];
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: prompt });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (route.providerId === 'openrouter') {
    headers['HTTP-Referer'] = 'https://shazam.ai';
    headers['X-Title'] = 'Shazam AI';
  }

  const liveModelId = resolveLiveProviderModel(route.providerId, model.providerModelId);
  const { signal: timedSignal, cleanup } = createTimeoutSignal(signal, 15000);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: liveModelId,
        messages,
        stream: true,
      }),
      signal: timedSignal,
    });
  } catch (err: any) {
    cleanup();
    if (signal?.aborted) throw new Error('Task cancelled');
    throw normalizeProviderError(route.providerId, err);
  } finally {
    cleanup();
  }

  if (!res.ok) {
    const errText = await res.text();
    throw normalizeProviderError(route.providerId, errText, res.status);
  }

  let fullText = '';
  let fullReasoning = '';
  let promptTokens = Math.max(10, Math.ceil(prompt.length / 4));
  let completionTokens = 0;
  let tokensKind: 'provider_reported' | 'estimated' = 'estimated';

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response body is unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const payload = trimmed.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta;

            // DeepSeek & OpenRouter reasoning content
            const reasoning = delta?.reasoning_content || delta?.reasoning;
            if (reasoning) {
              fullReasoning += reasoning;
              onChunk({ type: 'reasoning', text: reasoning });
            }

            if (delta?.content) {
              fullText += delta.content;
              onChunk({ type: 'delta', text: delta.content });
            }

            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
              completionTokens = parsed.usage.completion_tokens ?? completionTokens;
              tokensKind = 'provider_reported';
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) throw new Error('Task cancelled');
    throw err;
  }

  if (completionTokens === 0) {
    completionTokens = Math.max(1, Math.ceil(fullText.length / 4));
  }

  let costUSD = 0;
  let costKind: 'estimated' | 'unknown' | 'zero' = 'zero';

  if (route.costClass === 'verified_free') {
    costUSD = 0;
    costKind = 'zero';
  } else if (route.costClass === 'paid' && route.pricing) {
    const inputCost = (promptTokens * route.pricing.inputPer1M) / 1_000_000;
    const outputCost = (completionTokens * route.pricing.outputPer1M) / 1_000_000;
    costUSD = Number((inputCost + outputCost).toFixed(6));
    costKind = 'estimated';
  } else {
    costKind = 'unknown';
  }

  return {
    fullText,
    reasoning: fullReasoning || undefined,
    usage: { promptTokens, completionTokens, tokensKind },
    costUSD,
    costKind,
  };
}
