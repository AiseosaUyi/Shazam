import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { SHAZAM_SYSTEM_IDENTITY } from '../system-prompt';

export const OLLAMA_BASE_URL = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

export async function checkOllamaLiveness(): Promise<{ active: boolean; models: string[] }> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(1500) : undefined,
    });
    if (!res.ok) return { active: false, models: [] };
    const data = await res.json();
    const models = (data.models || []).map((m: any) => m.name || m.model);
    return { active: true, models };
  } catch {
    return { active: false, models: [] };
  }
}

export async function executeOllama(options: ExecuteOptions): Promise<AdapterResult> {
  const { model, prompt, history = [], signal, onChunk } = options;

  const ollamaModelName = model.providerModelId || 'qwen2.5-coder:7b';

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: SHAZAM_SYSTEM_IDENTITY },
  ];
  for (const h of history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: prompt });

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ollamaModelName,
        messages,
        stream: true,
      }),
      signal,
    });
  } catch (err: any) {
    if (signal?.aborted) throw new Error('Task cancelled by user');
    throw new Error(
      `Ollama local inference unavailable on ${OLLAMA_BASE_URL}. Ensure Ollama is running ('ollama serve' or launch Ollama desktop).`
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama returned status ${res.status}: ${errText || 'Internal local inference error'}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No readable response stream received from Ollama');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let promptTokens = Math.max(1, Math.ceil(prompt.length / 4));
  let completionTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          const delta = json.message.content;
          fullText += delta;
          onChunk({ type: 'delta', text: delta });
        }
        if (json.done) {
          if (json.prompt_eval_count) promptTokens = json.prompt_eval_count;
          if (json.eval_count) completionTokens = json.eval_count;
        }
      } catch {
        // partial ndjson chunk
      }
    }
  }

  if (completionTokens === 0) {
    completionTokens = Math.max(1, Math.ceil(fullText.length / 4));
  }

  return {
    fullText,
    usage: {
      promptTokens,
      completionTokens,
      tokensKind: 'observed',
    },
    costUSD: 0,
    costKind: 'zero',
  };
}
