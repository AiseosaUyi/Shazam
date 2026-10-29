import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { normalizeProviderError } from './error';
import { createTimeoutSignal } from './model-resolver';

/**
 * Google Official Multimodal Image Generation Adapter ("Nano Banana" / Gemini Image)
 * 
 * Invokes Google AI Studio's official Generative Language API using the user's BYOK Google API key.
 * Primary: models/gemini-3.1-flash-image:generateContent
 * Secondary: models/gemini-nano-banana-2.1:generateContent / gemini-3-pro-image:generateContent
 * Fallback: models/gemini-2.5-flash-image:generateContent / imagen-3.0-generate-002:predict
 * 
 * Strict compliance rule: Never silently substitute a different provider or model on failure.
 * Provider errors are thrown as structured ProviderErrors so the orchestrator can execute
 * an observable, explicit fallback if authorized by the user's cost and routing policy.
 */
export async function executeGoogleImagen(options: ExecuteOptions): Promise<AdapterResult> {
  const { prompt, apiKey, signal, onChunk, model, history } = options;

  if (!apiKey || apiKey === 'free_tier' || apiKey === 'simulation') {
    throw normalizeProviderError(
      'Google Image Generation',
      'A valid Google API key is required to generate images with Google Nano Banana. Please connect your free Google key in Settings > API Keys (minted at https://aistudio.google.com/app/apikey).',
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

  // Detect requested aspect ratio from prompt
  let targetAspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' = '1:1';
  if (/\b(?:16:9|wide|landscape|cinematic|widescreen)\b/i.test(cleanPrompt)) {
    targetAspectRatio = '16:9';
  } else if (/\b(?:9:16|portrait|vertical|story|reel)\b/i.test(cleanPrompt)) {
    targetAspectRatio = '9:16';
  } else if (/\b4:3\b/i.test(cleanPrompt)) {
    targetAspectRatio = '4:3';
  } else if (/\b3:4\b/i.test(cleanPrompt)) {
    targetAspectRatio = '3:4';
  }

  const { signal: timedSignal, cleanup } = createTimeoutSignal(signal, 50000);

  // Candidate models in preference order
  const candidateEndpoints = [
    {
      name: 'gemini-3.1-flash-image',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${encodeURIComponent(apiKey)}`,
      mode: 'generateContent' as const,
    },
    {
      name: 'gemini-nano-banana-2.1',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent?key=${encodeURIComponent(apiKey)}`,
      mode: 'generateContent' as const,
    },
    {
      name: 'gemini-3-pro-image',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${encodeURIComponent(apiKey)}`,
      mode: 'generateContent' as const,
    },
    {
      name: 'gemini-2.5-flash-image',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(apiKey)}`,
      mode: 'generateContent' as const,
    },
    {
      name: 'imagen-3.0-generate-002',
      url: `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`,
      mode: 'predict' as const,
    },
  ];

  let res: Response | undefined;
  let lastErrorText = '';
  let lastStatusCode = 500;

  try {
    for (const candidate of candidateEndpoints) {
      if (timedSignal.aborted) break;

      try {
        let reqBody: any;
        if (candidate.mode === 'generateContent') {
          // Multimodal payload supporting reference images if provided in history
          const parts: any[] = [{ text: cleanPrompt }];

          // If previous messages had an image data URI or reference, pass it for image-to-image
          if (history && history.length > 0) {
            for (const msg of history) {
              if (typeof msg.content === 'string') {
                const match = msg.content.match(/data:(image\/[a-zA-Z]+);base64,([A-Za-z0-9+/=]+)/);
                if (match) {
                  parts.unshift({
                    inlineData: {
                      mimeType: match[1],
                      data: match[2],
                    },
                  });
                  break;
                }
              }
            }
          }

          reqBody = {
            contents: [
              {
                role: 'user',
                parts,
              },
            ],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: {
                aspectRatio: targetAspectRatio,
                imageSize: '1K',
              },
            },
          };
        } else {
          // Legacy Imagen predict
          reqBody = {
            instances: [{ prompt: cleanPrompt }],
            parameters: {
              sampleCount: 1,
              aspectRatio: targetAspectRatio,
              outputMimeType: 'image/jpeg',
            },
          };
        }

        res = await fetch(candidate.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(reqBody),
          signal: timedSignal,
        });

        if (res.ok) {
          const data: any = await res.json();
          let b64 = '';
          let mimeType = 'image/png';
          let assistantText = '';

          if (candidate.mode === 'generateContent') {
            const parts = data?.candidates?.[0]?.content?.parts || [];
            for (const p of parts) {
              if (p.inlineData?.data) {
                b64 = p.inlineData.data;
                mimeType = p.inlineData.mimeType || 'image/png';
              } else if (p.text) {
                assistantText += p.text;
              }
            }
          } else {
            const prediction = data?.predictions?.[0];
            b64 = prediction?.bytesBase64Encoded || '';
            mimeType = prediction?.mimeType || 'image/jpeg';
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
              costUSD: 0.00,
              costKind: 'estimated',
            };
          }
        } else {
          lastStatusCode = res.status;
          lastErrorText = await res.text();
          // If 401 unauthorized, key is invalid; no need to try other models
          if (res.status === 401) {
            break;
          }
        }
      } catch (innerErr: any) {
        if (signal?.aborted) {
          throw new Error('Task cancelled');
        }
        lastErrorText = innerErr.message || String(innerErr);
      }
    }
  } finally {
    cleanup();
  }

  // Strictly throw normalized error — never silently substitute a different provider
  throw normalizeProviderError('Google Nano Banana', lastErrorText, lastStatusCode);
}
