import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { envFlag } from '@/lib/env';

export async function executeSimulation(options: ExecuteOptions): Promise<AdapterResult> {
  if (!envFlag('SHAZAM_ENABLE_SIMULATION', false)) {
    throw new Error('Simulation provider is disabled in this environment.');
  }

  const { prompt, signal, onChunk } = options;

  function generateSimulatedResponse(userPrompt: string): string {
    const p = userPrompt.toLowerCase().trim();

    if (p.includes('hi') || p.includes('hello') || p.includes('hey')) {
      return `Hello! 👋 Welcome to Shazam AI. I'm ready to assist you with reasoning, coding, drafting, or analyzing complex tasks.\n\nYou're currently chatting via Shazam's instant verified engine. You can also connect your own free Google Gemini API key anytime in **API Keys (Free)** in the top bar for direct access to Google AI Studio clusters!`;
    }

    if (p.includes('llm') || p.includes('large language model')) {
      return `A **Large Language Model (LLM)** is a deep learning AI model trained on massive text corpora to understand, summarize, generate, and reason with human language.\n\n### Core Architecture:\n- **Transformer Attention**: Computes statistical associations between words across long sequences.\n- **Context Windows**: Allows models like Gemini to digest up to 1,000,000+ tokens of documents and code.\n- **Intelligent Routing**: Shazam AI automatically chooses the fastest, most cost-effective model for each prompt (e.g. Gemini 2.0 Flash vs. GPT-4o).`;
    }

    return `Here is a response to your request:\n\n> "${userPrompt}"\n\nShazam AI has processed your prompt with intelligent model routing. To route your prompts directly to Google AI Studio with up to 1,000,000 context tokens at $0.00 cost, simply add your free Google key in **API Keys (Free)**.`;
  }

  const responseText = generateSimulatedResponse(prompt);
  const chunks = responseText.split(' ');
  let fullText = '';

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new Error('Task cancelled');
    const piece = (i === 0 ? '' : ' ') + chunks[i];
    fullText += piece;
    onChunk({ type: 'delta', text: piece });
    // realistic token streaming pacing
    await new Promise((r) => setTimeout(r, 15));
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
