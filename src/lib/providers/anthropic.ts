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

export class AnthropicAdapter implements ProviderAdapter {
  providerId = 'anthropic';

  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return { valid: false, error: 'Anthropic API key must start with sk-ant-' };
    }
    return { valid: true };
  }

  estimateCost(model: Model, route: Route, promptTokens: number, expectedOutputTokens: number): number {
    return calculateEstimatedCost(route, promptTokens, expectedOutputTokens);
  }

  async generateText(request: ExecutionRequest): Promise<{ text: string; usage: UsageNormalization }> {
    const apiKey = request.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Missing Anthropic API key. Connect your key in Connections.');
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model.providerModelId,
        messages: [{ role: 'user', content: request.prompt }],
        max_tokens: request.maxTokens ?? 4096,
        system: request.systemPrompt,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw this.normalizeError(errText, res.status);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    const promptTokens = data.usage?.input_tokens || Math.ceil(request.prompt.length / 4);
    const completionTokens = data.usage?.output_tokens || Math.ceil(text.length / 4);
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
    const apiKey = request.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Missing Anthropic API key. Connect your key in Connections.');
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model.providerModelId,
        messages: [{ role: 'user', content: request.prompt }],
        max_tokens: request.maxTokens ?? 4096,
        system: request.systemPrompt,
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
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullText += parsed.delta.text;
              onChunk({ type: 'delta', deltaText: parsed.delta.text });
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              completionTokens = parsed.usage.output_tokens;
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
    return standardErrorNormalizer('Anthropic', error, statusCode);
  }

  async healthCheck(route: Route): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: true, latencyMs: 50 };
  }
}
