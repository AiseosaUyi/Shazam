import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { createTimeoutSignal } from './model-resolver';
import { executeImageGeneration } from './image-generation';

/**
 * Google Imagen 3 Adapter ("Nano Banana")
 * 
 * Invokes Google AI Studio's flagship text-to-image model (imagen-3.0-generate-002:predict)
 * via the Generative Language API using the user's BYOK Google API key.
 * If the key lacks Vertex AI / Imagen entitlement, gracefully falls back to the high-resolution generator.
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
    // Seamlessly fulfill via high-fidelity image generator on network/endpoint error
    return executeImageGeneration(options);
  } finally {
    cleanup();
  }

  if (!res.ok) {
    // If Google Imagen 3 is not enabled on this AI Studio key, seamlessly fulfill via high-resolution generator
    return executeImageGeneration(options);
  }

  try {
    const data: any = await res.json();
    const prediction = data?.predictions?.[0];
    const b64 = prediction?.bytesBase64Encoded;
    const mimeType = prediction?.mimeType || 'image/jpeg';

    if (!b64) {
      return executeImageGeneration(options);
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
      costUSD: 0.03,
      costKind: 'estimated',
    };
  } catch {
    return executeImageGeneration(options);
  }
}
