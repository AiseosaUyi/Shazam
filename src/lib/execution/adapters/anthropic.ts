import type { ChatMessage, Model, Route, StreamChunk, Usage } from '@/lib/types';
import { normalizeProviderError } from './error';
import { ExecuteOptions, AdapterResult } from './openai-compatible';

export async function executeAnthropic(options: ExecuteOptions): Promise<AdapterResult> {
  const { model, route, prompt, history = [], apiKey, signal, onChunk } = options;

  const messages: any[] = [];
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: prompt });

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.providerModelId,
        messages,
        max_tokens: model.maxOutputTokens ?? 4096,
        stream: true,
      }),
      signal,
    });
  } catch (err: any) {
    if (signal?.aborted) throw new Error('Task cancelled');
    throw normalizeProviderError('Anthropic', err);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw normalizeProviderError('Anthropic', errText, res.status);
  }

  let fullText = '';
  let promptTokens = Math.max(10, Math.ceil(prompt.length / 4));
  let completionTokens = 0;
  let tokensKind: 'provider_reported' | 'estimated' = 'estimated';

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Streaming response body is unavailable.');

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
          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
              onChunk({ type: 'delta', text: parsed.delta.text });
            }
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              promptTokens = parsed.message.usage.input_tokens ?? promptTokens;
              tokensKind = 'provider_reported';
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              completionTokens = parsed.usage.output_tokens ?? completionTokens;
              tokensKind = 'provider_reported';
            }
          } catch {
            // ignore non-json
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
    usage: { promptTokens, completionTokens, tokensKind },
    costUSD,
    costKind,
  };
}
