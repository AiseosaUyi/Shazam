import type { ChatMessage, Model, Route, StreamChunk } from '@/lib/types';
import { executeOpenAICompatible, type AdapterResult } from './adapters/openai-compatible';
import { executeAnthropic } from './adapters/anthropic';
import { executeGemini } from './adapters/gemini';
import { executeSimulation } from './adapters/simulation';
import { executeImageGeneration } from './adapters/image-generation';
import { executeGoogleImagen } from './adapters/imagen';
import { executeOllama } from './adapters/ollama';

export interface DispatcherOptions {
  model: Model;
  route: Route;
  prompt: string;
  history?: ChatMessage[];
  apiKey: string;
  signal?: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
}

export async function dispatchExecution(options: DispatcherOptions): Promise<AdapterResult> {
  const { route, model } = options;

  if (route.providerId === 'google' && model.outputModality === 'image') {
    return executeGoogleImagen(options);
  }

  if (route.providerId === 'pollinations' || model.outputModality === 'image') {
    return executeImageGeneration(options);
  }

  switch (route.providerId) {
    case 'google':
      return executeGemini(options);
    case 'anthropic':
      return executeAnthropic(options);
    case 'openai':
      return executeOpenAICompatible(options, 'https://api.openai.com/v1/chat/completions');
    case 'deepseek':
      return executeOpenAICompatible(options, 'https://api.deepseek.com/chat/completions');
    case 'openrouter':
      return executeOpenAICompatible(options, 'https://openrouter.ai/api/v1/chat/completions');
    case 'ollama':
      return executeOllama(options);
    case 'simulation':
      return executeSimulation(options);
    default:
      throw new Error(`Unsupported provider: "${route.providerId}". Provider is either unverified or disabled.`);
  }
}
