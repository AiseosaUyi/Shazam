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

export class SimulationAdapter implements ProviderAdapter {
  providerId = 'simulation';

  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return { valid: true };
  }

  estimateCost(model: Model, route: Route, promptTokens: number, expectedOutputTokens: number): number {
    return calculateEstimatedCost(route, promptTokens, expectedOutputTokens);
  }

  async generateText(request: ExecutionRequest): Promise<{ text: string; usage: UsageNormalization }> {
    this.checkSimulatedFailures(request.prompt, request.route.id);

    const promptTokens = Math.ceil(request.prompt.length / 4);
    const text = `[Shazam Intelligence / ${request.model.canonicalName}]\n\nProcessed task: "${request.prompt.slice(0, 80)}${request.prompt.length > 80 ? '...' : ''}"\n\nExecution completed with verified zero-cost local route. Model: ${request.model.providerModelId} via ${request.route.accessMode}.`;
    const completionTokens = Math.ceil(text.length / 4);

    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUSD: 0.0,
      },
    };
  }

  async streamText(
    request: ExecutionRequest,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<{ fullText: string; usage: UsageNormalization }> {
    this.checkSimulatedFailures(request.prompt, request.route.id);

    const isReasoning = request.model.supportsReasoningExtraction || request.prompt.toLowerCase().includes('reason');
    if (isReasoning) {
      onChunk({
        type: 'reasoning',
        reasoningText: 'Analyzing intent, decomposing task constraints, and verifying capability bounds...',
      });
    }

    const sentences = [
      `Completed request via ${request.model.canonicalName} (${request.route.costClass}).\n\n`,
      `Task analyzed: "${request.prompt.slice(0, 90)}".\n\n`,
      `Here is the structured solution:\n`,
      `1. Verified policy compliance and capability matching.\n`,
      `2. Context window preserved: ${request.model.contextWindowTokens.toLocaleString()} tokens.\n`,
      `3. Routing rationale confirmed without unexpected paid fallbacks.\n\n`,
      `Result finalized successfully.`,
    ];

    let fullText = '';
    for (const s of sentences) {
      fullText += s;
      onChunk({ type: 'delta', deltaText: s });
    }

    const promptTokens = Math.max(12, Math.ceil(request.prompt.length / 4));
    const completionTokens = Math.max(25, Math.ceil(fullText.length / 4));
    const usage: UsageNormalization = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      reasoningTokens: isReasoning ? 18 : undefined,
      estimatedCostUSD: 0.0,
    };

    onChunk({ type: 'usage', usage });
    return { fullText, usage };
  }

  normalizeError(error: unknown, statusCode?: number): ProviderError {
    return standardErrorNormalizer('Simulator', error, statusCode);
  }

  async healthCheck(route: Route): Promise<{ healthy: boolean; latencyMs: number }> {
    return { healthy: true, latencyMs: 5 };
  }

  private checkSimulatedFailures(prompt: string, routeId?: string) {
    if (prompt.includes('[SIMULATE_429]') && (!routeId || routeId === 'route_shazam_sim_free')) {
      const err = new Error('Rate limit exceeded: 429 too many requests. Retry after 10s.');
      throw this.normalizeError(err, 429);
    }
    if (prompt.includes('[SIMULATE_QUOTA_EXHAUSTED]')) {
      const err = new Error('Insufficient quota or credit balance.');
      throw this.normalizeError(err, 402);
    }
    if (prompt.includes('[SIMULATE_500]')) {
      const err = new Error('Internal server error 500.');
      throw this.normalizeError(err, 500);
    }
    if (prompt.includes('[SIMULATE_TIMEOUT]')) {
      const err = new Error('Connection timeout after 30000ms.');
      throw this.normalizeError(err, 504);
    }
  }
}
