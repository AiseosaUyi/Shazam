import type { ChatMessage, Model, Route, StreamChunk } from '@/lib/types';
import { normalizeProviderError } from './error';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { resolveLiveProviderModel, createTimeoutSignal } from './model-resolver';
import { SHAZAM_SYSTEM_IDENTITY } from '../system-prompt';

export async function executeGemini(options: ExecuteOptions): Promise<AdapterResult> {
  const { model, route, prompt, history = [], apiKey, signal, onChunk } = options;

  const contents: any[] = [];
  for (const h of history) {
    contents.push({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: prompt }],
  });

  const liveModelId = resolveLiveProviderModel('google', model.providerModelId);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(liveModelId)}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;

  const { signal: timedSignal, cleanup } = createTimeoutSignal(signal, 45000);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SHAZAM_SYSTEM_IDENTITY }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: model.maxOutputTokens ?? 4096,
        },
      }),
      signal: timedSignal,
    });
  } catch (err: any) {
    cleanup();
    if (signal?.aborted) throw new Error('Task cancelled');
    throw normalizeProviderError('Google', err);
  } finally {
    cleanup();
  }

  // If 404 (model not found on target region), fallback to gemini-3.5-flash-lite
  if (res.status === 404 && liveModelId !== 'gemini-3.5-flash-lite') {
    const fallbackEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;
    const { signal: fbSignal, cleanup: fbCleanup } = createTimeoutSignal(signal, 45000);
    try {
      res = await fetch(fallbackEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SHAZAM_SYSTEM_IDENTITY }],
          },
          contents,
          generationConfig: {
            maxOutputTokens: model.maxOutputTokens ?? 4096,
          },
        }),
        signal: fbSignal,
      });
    } catch (err: any) {
      fbCleanup();
      if (signal?.aborted) throw new Error('Task cancelled');
      throw normalizeProviderError('Google', err);
    } finally {
      fbCleanup();
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw normalizeProviderError('Google', errText, res.status);
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
            const candidate = parsed.candidates?.[0];
            const parts = candidate?.content?.parts;
            if (Array.isArray(parts)) {
              for (const p of parts) {
                if (p.text) {
                  fullText += p.text;
                  onChunk({ type: 'delta', text: p.text });
                }
              }
            }

            if (parsed.usageMetadata) {
              promptTokens = parsed.usageMetadata.promptTokenCount ?? promptTokens;
              completionTokens = parsed.usageMetadata.candidatesTokenCount ?? completionTokens;
              tokensKind = 'provider_reported';
            }
          } catch {
            // Ignore malformed SSE chunk
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
