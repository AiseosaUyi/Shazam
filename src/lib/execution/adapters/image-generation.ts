import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';

/**
 * Free Image Generation Adapter using FLUX.1 Schnell via Pollinations AI.
 * 
 * Features:
 * - High-speed, zero-cost image generation powered by FLUX.1 Schnell (Black Forest Labs 12B flow transformer).
 * - Zero API key required, zero authentication barriers.
 * - Photorealistic quality, superior prompt adherence, and accurate typography.
 */
export async function executeImageGeneration(options: ExecuteOptions): Promise<AdapterResult> {
  const { prompt, signal, onChunk } = options;

  // Clean prompt to extract the subject/scene
  let cleanPrompt = prompt.trim();
  const leadingPhrases = [
    /^generate\s+(?:an?\s+)?image\s+(?:of\s+)?/i,
    /^generate\s+(?:an?\s+)?picture\s+(?:of\s+)?/i,
    /^create\s+(?:an?\s+)?image\s+(?:of\s+)?/i,
    /^create\s+(?:an?\s+)?picture\s+(?:of\s+)?/i,
    /^create\s+(?:an?\s+)?illustration\s+(?:of\s+)?/i,
    /^draw\s+(?:me\s+)?(?:an?\s+)?/i,
    /^paint\s+(?:me\s+)?(?:an?\s+)?/i,
    /^render\s+(?:an?\s+)?image\s+(?:of\s+)?/i,
    /^sketch\s+(?:of\s+)?/i,
  ];

  cleanPrompt = cleanPrompt.replace(/^["'`]+|["'`]+$/g, '').trim();
  for (const rx of leadingPhrases) {
    if (rx.test(cleanPrompt)) {
      cleanPrompt = cleanPrompt.replace(rx, '').trim();
      break;
    }
  }
  cleanPrompt = cleanPrompt.replace(/^["'`]+|["'`]+$/g, '').trim();

  if (!cleanPrompt) {
    cleanPrompt = prompt.trim().replace(/^["'`]+|["'`]+$/g, '');
  }

  // Generate unique seed for freshness
  const seed = Math.floor(Math.random() * 1000000);
  const encodedPrompt = encodeURIComponent(cleanPrompt);
  const imageUrl = `/api/v1/image?prompt=${encodedPrompt}&seed=${seed}`;

  if (signal?.aborted) throw new Error('Task cancelled');

  const fullText = `![${cleanPrompt.replace(/[\[\]]/g, '')}](${imageUrl})`;

  onChunk({
    type: 'delta',
    text: fullText,
  });

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
