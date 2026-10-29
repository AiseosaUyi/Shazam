import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { normalizeProviderError } from './error';
import { createTimeoutSignal } from './model-resolver';

/**
 * Google Imagen 3 Adapter ("Nano Banana")
 * 
 * Invokes Google AI Studio's flagship text-to-image model (imagen-3.0-generate-002:predict)
 * via the Generative Language API using the user's BYOK Google API key.
 */
export async function executeGoogleImagen(options: ExecuteOptions): Promise<AdapterResult> {
  const { prompt, apiKey, signal, onChunk } = options;

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

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`;
  const { signal: timedSignal, cleanup } = createTimeoutSignal(signal, 45000);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: cleanPrompt,
          },
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1',
          outputMimeType: 'image/jpeg',
        },
      }),
      signal: timedSignal,
    });
  } catch (err: any) {
    cleanup();
    if (signal?.aborted) throw new Error('Task cancelled');
    throw normalizeProviderError('Google Imagen', err);
  } finally {
    cleanup();
  }

  if (!res.ok) {
    const errText = await res.text();
    // If Imagen endpoint is restricted on this particular key, throw provider error so router can fallback to FLUX
    throw normalizeProviderError('Google Imagen', errText, res.status);
  }

  const data: any = await res.json();
  const prediction = data?.predictions?.[0];
  const b64 = prediction?.bytesBase64Encoded;
  const mimeType = prediction?.mimeType || 'image/jpeg';

  if (!b64) {
    throw new Error('Google Imagen 3 API returned an empty image prediction.');
  }

  const imageUrl = `data:${mimeType};base64,${b64}`;
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
    costUSD: 0.03, // ~$0.03 standard Imagen 3 generation cost
    costKind: 'estimated',
  };
}
