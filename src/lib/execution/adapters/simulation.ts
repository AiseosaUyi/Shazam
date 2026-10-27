import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { envFlag } from '@/lib/env';

export async function executeSimulation(options: ExecuteOptions): Promise<AdapterResult> {
  if (!envFlag('SHAZAM_ENABLE_SIMULATION', false)) {
    throw new Error('Simulation provider is disabled in this environment.');
  }

  const { prompt, signal, onChunk } = options;

  const mockResponse = `[Demo] Shazam AI simulated response for your prompt:\n\n> "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"\n\nThis is an offline demonstration response. Simulation mode is enabled for development and testing.`;

  const chunks = mockResponse.split(' ');
  let fullText = '';

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new Error('Task cancelled');
    const piece = (i === 0 ? '' : ' ') + chunks[i];
    fullText += piece;
    onChunk({ type: 'delta', text: piece });
    // short delay in simulated stream
    await new Promise((r) => setTimeout(r, 20));
  }

  const promptTokens = Math.max(1, Math.ceil(prompt.length / 4));
  const completionTokens = Math.max(1, Math.ceil(fullText.length / 4));

  return {
    fullText,
    usage: {
      promptTokens,
      completionTokens,
      tokensKind: 'estimated',
    },
    costUSD: 0,
    costKind: 'zero',
  };
}
