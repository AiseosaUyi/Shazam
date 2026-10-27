import { ProviderAdapter } from '@/types/provider';
import { GoogleGeminiAdapter } from './google-gemini';
import { DeepSeekAdapter } from './deepseek';
import { OpenRouterAdapter } from './openrouter';
import { OpenAIAdapter } from './openai';
import { AnthropicAdapter } from './anthropic';
import { AlibabaQwenAdapter } from './alibaba-qwen';
import { SimulationAdapter } from './simulation';

class ProviderRegistry {
  private adapters: Map<string, ProviderAdapter> = new Map();

  constructor() {
    this.register(new GoogleGeminiAdapter());
    this.register(new DeepSeekAdapter());
    this.register(new OpenRouterAdapter());
    this.register(new OpenAIAdapter());
    this.register(new AnthropicAdapter());
    this.register(new AlibabaQwenAdapter());
    this.register(new SimulationAdapter());
  }

  public register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  public getAdapter(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`No provider adapter registered for provider ID: "${providerId}".`);
    }
    return adapter;
  }

  public hasAdapter(providerId: string): boolean {
    return this.adapters.has(providerId);
  }
}

export const providerRegistry = new ProviderRegistry();
