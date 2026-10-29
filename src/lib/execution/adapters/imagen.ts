import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { normalizeProviderError } from './error';
import { createTimeoutSignal } from './model-resolver';

/**
 * Google Official Image Generation Adapter ("Nano Banana" / Gemini Image)
 * 
 * Invokes Google AI Studio's official Generative Language API using the user's BYOK Google API key.
 * Primary: models/gemini-2.5-flash-image:generateContent with responseModalities: ["TEXT", "IMAGE"]
 * Secondary / Legacy: models/imagen-3.0-generate-002:predict
 * 
 * Strict compliance rule: Never silently substitute a different provider or model on failure.
 * Provider errors are thrown as structured ProviderErrors so the orchestrator can execute
 * an observable, explicit fallback if authorized by the user's cost and routing policy.
 */
export async function executeGoogleImagen(options: ExecuteOptions): Promise<AdapterResult> {
  const { prompt, apiKey, signal, onChunk, model } = options;

  if (!apiKey || apiKey === 'free_tier' || apiKey === 'simulation') {
    throw normalizeProviderError(
      'Google Image Generation',
      'A valid Google API key is required to generate images with Google Imagen / Gemini. Please connect your Google key in Settings > API Keys.',
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

  const { signal: timedSignal, cleanup } = createTimeoutSignal(signal, 45000);

  // Strategy 1: Attempt official Gemini Image endpoint (gemini-2.5-flash-image:generateContent)
  const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(apiKey)}`;
  
  let res: Response | undefined;
  let lastErrorText = '';
  let lastStatusCode = 500;

  try {
    res = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: cleanPrompt }],
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
      signal: timedSignal,
    });

    if (res.ok) {
      const data: any = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      let b64 = '';
      let mimeType = 'image/png';
      let assistantText = '';

      for (const p of parts) {
        if (p.inlineData?.data) {
          b64 = p.inlineData.data;
          mimeType = p.inlineData.mimeType || 'image/png';
        } else if (p.text) {
          assistantText += p.text;
        }
      }

      if (b64) {
        const imageUrl = `data:${mimeType};base64,${b64}`;
        const imageMarkdown = `![${cleanPrompt.replace(/[\[\]]/g, '')}](${imageUrl})`;
        const fullText = assistantText ? `${assistantText.trim()}\n\n${imageMarkdown}` : imageMarkdown;

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
      }
    } else {
      lastStatusCode = res.status;
      lastErrorText = await res.text();
    }
  } catch (err: any) {
    if (signal?.aborted) {
      cleanup();
      throw new Error('Task cancelled');
    }
    lastErrorText = err.message || String(err);
  }

  // Strategy 2: If gemini-2.5-flash-image returned 404 or failed, attempt legacy Imagen 3 endpoint
  const imagenEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`;
  try {
    res = await fetch(imagenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        instances: [{ prompt: cleanPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1',
          outputMimeType: 'image/jpeg',
        },
      }),
      signal: timedSignal,
    });

    if (res.ok) {
      const data: any = await res.json();
      const prediction = data?.predictions?.[0];
      const b64 = prediction?.bytesBase64Encoded;
      const mimeType = prediction?.mimeType || 'image/jpeg';

      if (b64) {
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
      }
    } else {
      lastStatusCode = res.status;
      lastErrorText = await res.text();
    }
  } catch (err: any) {
    if (signal?.aborted) {
      cleanup();
      throw new Error('Task cancelled');
    }
    lastErrorText = err.message || String(err);
  } finally {
    cleanup();
  }

  // Strictly throw normalized error — never silently substitute a different provider
  throw normalizeProviderError('Google Imagen', lastErrorText, lastStatusCode);
}
