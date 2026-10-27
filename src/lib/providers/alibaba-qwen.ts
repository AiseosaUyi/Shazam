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

export class AlibabaQwenAdapter implements ProviderAdapter {
  providerId = 'alibaba';

  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    if (!apiKey || apiKey.length < 10) {
      return { valid: false, error: 'Alibaba DashScope API key is required.' };
    }
    return { valid: true };
  }

  estimateCost(model: Model, route: Route, promptTokens: number, expectedOutputTokens: number): number {
    return calculateEstimatedCost(route, promptTokens, expectedOutputTokens);
  }

  async generateText(request: ExecutionRequest): Promise<{ text: string; usage: UsageNormalization }> {
    const apiKey = request.apiKey || process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('Missing Alibaba DashScope API key. Connect your key in Connections.');
    }

    const endpoint = request.route.endpointUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model.providerModelId,
        messages: [{ role: 'user', content: request.prompt }],
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

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUSD: this.estimateCost(request.model, request.route, promptTokens, completionTokens),
      },
    };
  }

  async streamText(
    request: ExecutionRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<{ fullText: string; usage: UsageNormalization }> {
    return this.generateText(request).then((res) => {
      onChunk({ type: 'delta', deltaText: res.text });
      onChunk({ type: 'usage', usage: res.usage });
      return { fullText: res.text, usage: res.usage };
    });
  }

  normalizeError(error: unknown, statusCode?: number): ProviderError {
    return standardErrorNormalizer('Alibaba Qwen', error, statusCode);
  }

  async healthCheck(route: Route): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: true, latencyMs: 120 };
  }
}
