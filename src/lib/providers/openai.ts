import {
  ExecutionRequest,
  Model,
  ProviderAdapter,
  ProviderError,
  Route,
  StreamChunk,
  UsageNormalization,
} from '@/types/provider';
import { calculateEstimatedCost, standardErrorNormalizer } from './adapter-base';

export class OpenAIAdapter implements ProviderAdapter {
  providerId = 'openai';

  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    if (!apiKey || !apiKey.startsWith('sk-')) {
      return { valid: false, error: 'OpenAI API key must start with sk-' };
    }
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        return { valid: false, error: `Validation failed: HTTP ${res.status}` };
      }
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  estimateCost(model: Model, route: Route, promptTokens: number, expectedOutputTokens: number): number {
    return calculateEstimatedCost(route, promptTokens, expectedOutputTokens);
  }

  async generateText(request: ExecutionRequest): Promise<{ text: string; usage: UsageNormalization }> {
    const apiKey = request.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OpenAI API key. Connect your key in Connections.');
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model.providerModelId,
        messages: [
          ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
          { role: 'user', content: request.prompt },
        ],
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 4096,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw this.normalizeError(errText, res.status);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    const promptTokens = data.usage?.prompt_tokens || Math.ceil(request.prompt.length / 4);
    const completionTokens = data.usage?.completion_tokens || Math.ceil(text.length / 4);
    const totalTokens = promptTokens + completionTokens;

    const estimatedCostUSD = this.estimateCost(request.model, request.route, promptTokens, completionTokens);

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUSD,
      },
    };
  }

  async streamText(
    request: ExecutionRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<{ fullText: string; usage: UsageNormalization }> {
    const apiKey = request.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OpenAI API key. Connect your key in Connections.');
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model.providerModelId,
        messages: [
          ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
          { role: 'user', content: request.prompt },
        ],
        stream: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw this.normalizeError(errText, res.status);
    }

    let fullText = '';
    let promptTokens = Math.ceil(request.prompt.length / 4);
    let completionTokens = 0;

    const reader = res.body?.getReader();
    if (!reader) {
      const gen = await this.generateText(request);
      return { fullText: gen.text, usage: gen.usage };
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk({ type: 'delta', deltaText: delta });
            }
          } catch {
            // ignore non-json
          }
        }
      }
    }

    if (completionTokens === 0) {
      completionTokens = Math.ceil(fullText.length / 4);
    }

    const estimatedCostUSD = this.estimateCost(request.model, request.route, promptTokens, completionTokens);
    const usage: UsageNormalization = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUSD,
    };

    onChunk({ type: 'usage', usage });
    return { fullText, usage };
  }

  normalizeError(error: unknown, statusCode?: number): ProviderError {
    return standardErrorNormalizer('OpenAI', error, statusCode);
  }

  async healthCheck(route: Route): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const res = await fetch('https://api.openai.com/v1/models', { method: 'GET' });
      return { healthy: res.status !== 503, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}
