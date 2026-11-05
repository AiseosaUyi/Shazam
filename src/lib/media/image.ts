import { generateImage, generateText, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { put } from '@vercel/blob';
import type { PlatformRepo, MediaAsset } from '@/lib/db/platform-repo';
import { errMessage } from '@/lib/errors';

/**
 * Image generation pipeline:
 *   1. Prompt enhancement (an LLM rewrites a short idea into a full visual brief).
 *   2. Provider: the user's own key first (Google Nano Banana, OpenAI), otherwise the
 *      platform default through Vercel AI Gateway (FLUX.2 klein 4B, free-tier credits, capped per day).
 *   3. Stored in Vercel Blob and recorded in the user's media library (never base64 in chat).
 */

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface ImageRequest {
  userId: string;
  prompt: string;
  aspectRatio?: AspectRatio;
  /** Public URL of an image to edit / use as reference. */
  referenceImageUrl?: string;
  enhance?: boolean;
  /** Text model used for prompt enhancement (the user's routed model). */
  enhancer?: LanguageModel | null;
  googleApiKey?: string | null;
  openaiApiKey?: string | null;
}

export interface ImageResult {
  asset: MediaAsset;
  provider: string;
  model: string;
  finalPrompt: string;
  enhanced: boolean;
}

export const GATEWAY_IMAGE_MODEL = process.env.SHAZAM_DEFAULT_IMAGE_MODEL || 'bfl/flux-2-klein-4b';
const DAILY_LIMIT = Number(process.env.SHAZAM_IMAGE_DAILY_LIMIT || 25);

/** Gateway FLUX ignores aspectRatio but honors explicit sizes (verified 2026-10-30). */
const GATEWAY_SIZES: Record<AspectRatio, `${number}x${number}`> = {
  '1:1': '1024x1024',
  '16:9': '1344x768',
  '9:16': '768x1344',
  '4:3': '1152x896',
  '3:4': '896x1152',
};

export function gatewayAvailable(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

const ENHANCER_INSTRUCTIONS = `You turn short image ideas into one precise prompt for a text-to-image model.
Keep every concrete detail the user gave (subjects, text to render, colors, brand names) exactly.
Add: subject description, setting, composition and camera framing, lens / medium, lighting, mood, color palette, and style.
If the user wants text in the image, put the exact text in double quotes and say where it appears.
Keep rendered text short (a headline of at most 4 words plus one short line); image models misspell long text. Spell every word exactly.
For people: natural anatomy, realistic hands, true-to-life skin texture.
Output ONLY the final prompt, 60-120 words, no preamble.`;

export async function enhanceImagePrompt(model: LanguageModel, prompt: string): Promise<string> {
  const { text } = await generateText({
    model,
    instructions: ENHANCER_INSTRUCTIONS,
    prompt,
    maxOutputTokens: 300,
  });
  const out = text.trim().replace(/^["']|["']$/g, '');
  return out.length > 20 ? out : prompt;
}

async function fetchImageBytes(url: string): Promise<{ data: Uint8Array; mimeType: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Could not download reference image (HTTP ${res.status}).`);
  return { data: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get('content-type') || 'image/png' };
}

/** Google Nano Banana (Gemini image models) — needs a billing-enabled AI Studio key. */
async function generateWithNanoBanana(apiKey: string, prompt: string, aspectRatio: AspectRatio, reference?: { data: Uint8Array; mimeType: string }) {
  const parts: any[] = [];
  if (reference) parts.push({ inlineData: { mimeType: reference.mimeType, data: Buffer.from(reference.data).toString('base64') } });
  parts.push({ text: prompt });

  let lastError = '';
  for (const model of ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image']) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (res.status === 404) continue;
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 429 || /billing|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        throw new Error('Google Nano Banana needs billing enabled on your Google AI Studio key (Gemini image models have no free tier).');
      }
      lastError = msg;
      continue;
    }
    const img = (data?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
    if (img) return { bytes: Buffer.from(img.inlineData.data, 'base64'), mimeType: img.inlineData.mimeType || 'image/png', model };
    lastError = 'The model returned no image (it may have refused the prompt).';
  }
  throw new Error(`Google Nano Banana failed: ${lastError || 'no image model available to this key'}`);
}

async function countImagesToday(platform: PlatformRepo, userId: string): Promise<number> {
  const since = new Date(Date.now() - 86400_000).toISOString();
  return (await platform.listMedia(userId, 'image')).filter((m) => m.createdAt >= since && m.meta?.billedTo === 'platform').length;
}

export async function generateAndStoreImage(req: ImageRequest, platform: PlatformRepo): Promise<ImageResult> {
  const aspectRatio = req.aspectRatio || '1:1';
  let finalPrompt = req.prompt.trim();
  let enhanced = false;
  if (req.enhance !== false && req.enhancer) {
    try {
      finalPrompt = await enhanceImagePrompt(req.enhancer, finalPrompt);
      enhanced = finalPrompt !== req.prompt.trim();
    } catch {
      // Enhancement is best-effort; generate from the original prompt.
    }
  }
  const reference = req.referenceImageUrl ? await fetchImageBytes(req.referenceImageUrl) : undefined;

  let bytes: Uint8Array | null = null;
  let mimeType = 'image/png';
  let provider = '';
  let model = '';
  let billedTo: 'user' | 'platform' = 'user';
  const errors: string[] = [];

  if (req.googleApiKey) {
    try {
      const r = await generateWithNanoBanana(req.googleApiKey, finalPrompt, aspectRatio, reference);
      bytes = r.bytes;
      mimeType = r.mimeType;
      provider = 'Google Nano Banana';
      model = r.model;
    } catch (err) {
      errors.push(errMessage(err));
    }
  }

  if (!bytes && req.openaiApiKey) {
    try {
      const { image } = await generateImage({
        model: createOpenAI({ apiKey: req.openaiApiKey }).image('gpt-image-1'),
        prompt: reference ? { images: [reference.data], text: finalPrompt } : finalPrompt,
        aspectRatio,
      });
      bytes = image.uint8Array;
      mimeType = image.mediaType || 'image/png';
      provider = 'OpenAI';
      model = 'gpt-image-1';
    } catch (err) {
      errors.push(`OpenAI: ${errMessage(err)}`);
    }
  }

  if (!bytes && gatewayAvailable()) {
    if ((await countImagesToday(platform, req.userId)) >= DAILY_LIMIT) {
      errors.push(`Free daily image limit reached (${DAILY_LIMIT}/day). Add your own Google (billing enabled) or OpenAI key for unlimited images.`);
    } else {
      try {
        const { image } = await generateImage({
          model: GATEWAY_IMAGE_MODEL,
          prompt: reference ? { images: [reference.data], text: finalPrompt } : finalPrompt,
          size: GATEWAY_SIZES[aspectRatio],
        });
        bytes = image.uint8Array;
        mimeType = image.mediaType || 'image/png';
        provider = 'Vercel AI Gateway';
        model = GATEWAY_IMAGE_MODEL;
        billedTo = 'platform';
      } catch (err) {
        errors.push(`${GATEWAY_IMAGE_MODEL}: ${errMessage(err)}`);
      }
    }
  }

  if (!bytes) {
    throw new Error(errors.length ? errors.join(' | ') : 'No image provider is available. Connect a Google (billing) or OpenAI key.');
  }

  const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
  const blob = await put(`images/${req.userId}/${Date.now()}.${ext}`, Buffer.from(bytes), {
    access: 'public',
    addRandomSuffix: true,
    contentType: mimeType,
  });

  const asset = await platform.addMedia(req.userId, {
    kind: 'image',
    url: blob.url,
    prompt: req.prompt,
    model: `${provider} · ${model}`,
    meta: { finalPrompt, enhanced, aspectRatio, provider, billedTo, edit: Boolean(reference) },
  });
  return { asset, provider, model, finalPrompt, enhanced };
}
