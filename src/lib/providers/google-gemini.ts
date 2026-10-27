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

export class GoogleGeminiAdapter implements ProviderAdapter {
  providerId = 'google';

  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    if (!apiKey || apiKey.length < 20) {
      return { valid: false, error: 'Google API key must be a valid AI Studio token.' };
    }
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        const body = await res.text();
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
    const apiKey = request.apiKey || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing Google AI API key. Please connect your key in Connections.');
    }

    const modelId = request.model.providerModelId;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contents: any[] = [];
    if (request.systemPrompt) {
      // Gemini system instruction can be passed or prepended
    }

    contents.push({
      role: 'user',
      parts: [{ text: request.prompt }],
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? 4096,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw this.normalizeError(errText, res.status);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';

    const promptTokens = data.usageMetadata?.promptTokenCount || Math.ceil(request.prompt.length / 4);
    const completionTokens = data.usageMetadata?.candidatesTokenCount || Math.ceil(text.length / 4);
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
    const apiKey = request.apiKey || process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing Google AI API key. Please connect your key in Connections.');
    }

    const modelId = request.model.providerModelId;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: {
          temperature: request.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? 4096,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw this.normalizeError(errText, res.status);
    }

    let fullText = '';
    let promptTokens = 0;
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
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
            if (delta) {
              fullText += delta;
              onChunk({ type: 'delta', deltaText: delta });
            }
            if (parsed.usageMetadata) {
              promptTokens = parsed.usageMetadata.promptTokenCount;
              completionTokens = parsed.usageMetadata.candidatesTokenCount;
            }
          } catch {
            // ignore non-json stream lines
          }
        }
      }
    }

    if (completionTokens === 0) {
      completionTokens = Math.ceil(fullText.length / 4);
      promptTokens = Math.ceil(request.prompt.length / 4);
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
    return standardErrorNormalizer('Google Gemini', error, statusCode);
  }

  async healthCheck(route: Route): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1`, {
        method: 'GET',
      });
      return { healthy: res.status !== 503, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}
