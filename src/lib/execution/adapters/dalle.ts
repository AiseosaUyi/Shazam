import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { normalizeProviderError } from './error';
import { createTimeoutSignal } from './model-resolver';

/**
 * OpenAI DALL-E 3 Image Generation Adapter
 * 
 * Invokes official OpenAI image generation endpoint:
 * POST https://api.openai.com/v1/images/generations
 * Returns pristine high-definition image bytes (b64_json) with ZERO watermarks.
 */
export async function executeOpenAIDalle(options: ExecuteOptions): Promise<AdapterResult> {
  const { prompt, apiKey, signal, onChunk } = options;

  if (!apiKey || apiKey === 'free_tier' || apiKey === 'simulation') {
    throw normalizeProviderError(
      'OpenAI DALL-E 3',
      'An OpenAI API key is required to generate images with DALL-E 3. Please connect your OpenAI key in Settings > API Keys.',
      401
    );
  }

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
  ];

  for (const rx of leadingPhrases) {
    if (rx.test(cleanPrompt)) {
      cleanPrompt = cleanPrompt.replace(rx, '').trim();
      break;
    }
  }

  let size: '1024x1024' | '1024x1792' | '1792x1024' = '1024x1024';
  if (/\b(?:wide|landscape|16:9|widescreen|cinematic)\b/i.test(cleanPrompt)) {
    size = '1792x1024';
  } else if (/\b(?:portrait|vertical|9:16|story|reel)\b/i.test(cleanPrompt)) {
    size = '1024x1792';
  }

  const { signal: timedSignal, cleanup } = createTimeoutSignal(signal, 60000);

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: cleanPrompt,
        n: 1,
        size,
        quality: 'standard',
        response_format: 'b64_json',
      }),
      signal: timedSignal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw normalizeProviderError('OpenAI DALL-E 3', errText, res.status);
    }

    const json: any = await res.json();
    const item = json.data?.[0];
    const b64 = item?.b64_json;
    const revisedPrompt = item?.revised_prompt || cleanPrompt;

    if (!b64) {
      throw normalizeProviderError('OpenAI DALL-E 3', 'No image data returned in OpenAI response.', 502);
    }

    const imageUrl = `data:image/png;base64,${b64}`;
    const fullText = `![${cleanPrompt.replace(/[\[\]]/g, '')}](${imageUrl})`;

    onChunk({
      type: 'delta',
      text: fullText,
    });

    const costUSD = size === '1024x1024' ? 0.04 : 0.08;

    return {
      fullText,
      usage: {
        promptTokens: Math.max(1, Math.ceil(cleanPrompt.length / 4)),
        completionTokens: Math.max(1, Math.ceil(revisedPrompt.length / 4)),
        tokensKind: 'estimated',
      },
      costUSD,
      costKind: 'estimated',
    };
  } finally {
    cleanup();
  }
}
