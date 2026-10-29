import type { StreamChunk } from '@/lib/types';
import type { ExecuteOptions, AdapterResult } from './openai-compatible';
import { normalizeProviderError } from './error';
import { createTimeoutSignal } from './model-resolver';

/**
 * Cloudflare Workers AI Image Generation Adapter
 * 
 * Invokes serverless FLUX.1 Schnell or SDXL on Cloudflare Workers AI.
 * Endpoint: POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/black-forest-labs/flux-1-schnell
 * Returns pristine binary PNG bytes with ZERO third-party watermarks.
 */
export async function executeCloudflareImage(options: ExecuteOptions, accountId?: string): Promise<AdapterResult> {
  const { prompt, apiKey, signal, onChunk } = options;

  if (!apiKey || apiKey === 'free_tier' || apiKey === 'simulation') {
    throw normalizeProviderError(
      'Cloudflare Workers AI',
      'A valid Cloudflare API token is required. Create one at https://dash.cloudflare.com/profile/api-tokens with Workers AI Read/Write permissions.',
      401
    );
  }

  const cfAccountId = accountId || process.env.CLOUDFLARE_ACCOUNT_ID || 'current';
  const cleanPrompt = prompt.trim();
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfAccountId)}/ai/run/@cf/black-forest-labs/flux-1-schnell`;

  const { signal: timedSignal, cleanup } = createTimeoutSignal(signal, 45000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: cleanPrompt,
        num_steps: 4,
      }),
      signal: timedSignal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw normalizeProviderError('Cloudflare Workers AI', errText, res.status);
    }

    // Cloudflare returns image/png bytes or JSON with base64 image
    const contentType = res.headers.get('content-type') || '';
    let b64 = '';

    if (contentType.includes('application/json')) {
      const json: any = await res.json();
      b64 = json.result?.image || '';
    } else {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      b64 = buffer.toString('base64');
    }

    if (!b64) {
      throw normalizeProviderError('Cloudflare Workers AI', 'Empty image payload returned from Workers AI.', 502);
    }

    const imageUrl = `data:image/png;base64,${b64}`;
    const fullText = `![${cleanPrompt.replace(/[\[\]]/g, '')}](${imageUrl})`;

    onChunk({
      type: 'delta',
      text: fullText,
    });

    return {
      fullText,
      usage: {
        promptTokens: Math.max(1, Math.ceil(prompt.length / 4)),
        completionTokens: Math.max(1, Math.ceil(fullText.length / 4)),
        tokensKind: 'estimated',
      },
      costUSD: 0.00,
      costKind: 'estimated',
    };
  } finally {
    cleanup();
  }
}
