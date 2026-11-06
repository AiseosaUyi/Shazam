import { tool, type LanguageModel, type ToolSet } from 'ai';
import { z } from 'zod';
import type { DbRepo } from '@/lib/db/repo';
import type { PlatformRepo } from '@/lib/db/platform-repo';
import { decryptSecret } from '@/lib/crypto/vault';
import { sandboxAvailable } from '@/lib/agent/sandbox';
import { generateAndStoreImage, gatewayAvailable } from './image';
import { VideoEditor, buildSrt } from './video';
import { videoReviewNotes } from './review';
import { errMessage } from '@/lib/errors';

async function userKey(repo: DbRepo, userId: string, provider: string): Promise<string | null> {
  const cred = await repo.getCredential(userId, provider);
  if (!cred || cred.status !== 'valid') return null;
  return decryptSecret(cred.encryptedKey).catch(() => null);
}

export async function buildMediaTools(
  userId: string,
  repo: DbRepo,
  platform: PlatformRepo,
  opts: { enhancer?: LanguageModel | null; onAsset?: (asset: { id: string; kind: string; url: string; prompt?: string | null; model?: string | null }) => void } = {}
): Promise<{ tools: ToolSet; inventory: string }> {
  const [googleKey, openaiKey] = await Promise.all([userKey(repo, userId, 'google'), userKey(repo, userId, 'openai')]);
  // A keyless free image route exists as the last fallback, so images are always offered.
  const canImage = true;
  const canVideo = sandboxAvailable();
  const tools: ToolSet = {};

  if (canImage) {
    tools.generate_image = tool({
      description: 'Generate an image (or edit one by passing reference_image_url). The prompt is automatically expanded into a detailed visual brief.',
      inputSchema: z.object({
        prompt: z.string().describe('What to create, with every concrete detail the user gave (text to render in quotes).'),
        aspect_ratio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional(),
        reference_image_url: z.string().url().optional().describe('Public URL of an image to edit or use as reference (e.g. a previous result).'),
      }),
      execute: async ({ prompt, aspect_ratio, reference_image_url }) => {
        try {
          const r = await generateAndStoreImage(
            { userId, prompt, aspectRatio: aspect_ratio, referenceImageUrl: reference_image_url, enhancer: opts.enhancer, googleApiKey: googleKey, openaiApiKey: openaiKey },
            platform
          );
          opts.onAsset?.({ id: r.asset.id, kind: 'image', url: r.asset.url, prompt, model: r.asset.model });
          return `Image created with ${r.provider} (${r.model}).\n![${prompt.replace(/[\[\]]/g, '').slice(0, 80)}](${r.asset.url})\nURL: ${r.asset.url}${r.enhanced ? `\nExpanded prompt: ${r.finalPrompt}` : ''}`;
        } catch (err) {
          return `Error: image generation failed: ${errMessage(err)}`;
        }
      },
    });
  }

  if (canVideo) {
    tools.edit_video = tool({
      description: 'Edit a video with real ffmpeg. Apply operations in order. Returns a playable MP4 URL. Typical social edit: cut_silences → reframe 9:16 → captions.',
      inputSchema: z.object({
        source_url: z.string().url().describe('Public https URL of the source video (uploaded files have one).'),
        title: z.string().optional(),
        operations: z.array(z.discriminatedUnion('op', [
          z.object({ op: z.literal('trim'), start: z.number().min(0), end: z.number().optional() }),
          z.object({ op: z.literal('cut_silences'), min_silence: z.number().min(0.2).max(5).optional(), threshold_db: z.number().min(-70).max(-10).optional() }),
          z.object({ op: z.literal('reframe'), aspect: z.enum(['9:16', '1:1', '16:9', '4:5']) }),
          z.object({ op: z.literal('speed'), factor: z.number().min(0.25).max(4) }),
          z.object({ op: z.literal('captions'), style: z.enum(['bold', 'clean']).optional(), position: z.enum(['bottom', 'middle']).optional() }),
          z.object({ op: z.literal('add_music'), url: z.string().url(), volume: z.number().min(0).max(1).optional() }),
          z.object({ op: z.literal('concat'), urls: z.array(z.string().url()).min(1).max(10) }),
          z.object({ op: z.literal('mute') }),
        ])).min(1).max(12),
      }),
      execute: async ({ source_url, operations, title }) => {
        try {
          const r = await new VideoEditor(userId).edit(source_url, operations as any, platform, title || 'Edited video');
          opts.onAsset?.({ id: r.asset.id, kind: 'video', url: r.asset.url, prompt: title, model: r.asset.model });
          return `Video rendered (${r.durationSeconds.toFixed(1)}s).\nSteps:\n- ${r.log.join('\n- ')}\nURL: ${r.asset.url}\n\n${videoReviewNotes(r.durationSeconds, operations as any)}`;
        } catch (err) {
          return `Error: video edit failed: ${errMessage(err)}`;
        }
      },
    });
    tools.animate_image = tool({
      description: 'Turn a still image into a short motion video (slow zoom or pan, fades, optional text that fades in) with real ffmpeg. Use for motion graphics, story clips and animated logos: first generate_image, then animate_image with its URL. Returns a playable MP4 URL. Real animation of objects (a bolt "drawing itself") is not possible; be honest about that.',
      inputSchema: z.object({
        image_url: z.string().url().describe('Public https URL of the image (e.g. from generate_image).'),
        motion: z.enum(['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'none']).optional(),
        aspect: z.enum(['9:16', '1:1', '16:9', '4:5']).optional().describe('Default 9:16 (stories/reels).'),
        seconds: z.number().min(2).max(15).optional().describe('Default 6.'),
        text: z.string().max(80).optional().describe('Overlay text that fades in (no emoji).'),
        text_position: z.enum(['top', 'middle', 'bottom']).optional(),
        title: z.string().optional(),
      }),
      execute: async ({ image_url, motion, aspect, seconds, text, text_position, title }) => {
        try {
          const r = await new VideoEditor(userId).animateImage(image_url, { motion, aspect, seconds, text, textAt: text_position, title }, platform);
          opts.onAsset?.({ id: r.asset.id, kind: 'video', url: r.asset.url, prompt: title || text, model: r.asset.model });
          return `Motion clip rendered (${r.durationSeconds.toFixed(1)}s).\nSteps:\n- ${r.log.join('\n- ')}\nURL: ${r.asset.url}`;
        } catch (err) {
          return `Error: animation failed: ${errMessage(err)}`;
        }
      },
    });
    tools.transcribe_video = tool({
      description: 'Transcribe a video or audio file and return the transcript with timestamps (for summaries, shot lists, or picking trims).',
      inputSchema: z.object({ source_url: z.string().url() }),
      execute: async ({ source_url }) => {
        try {
          const editor = new VideoEditor(userId);
          const r = await editor.transcribeUrl(source_url);
          return `Transcript (${r.durationInSeconds?.toFixed?.(1) ?? '?'}s):\n${buildSrt(r.segments as any, 12, 6).slice(0, 15000)}`;
        } catch (err) {
          return `Error: transcription failed: ${errMessage(err)}`;
        }
      },
    });
  }

  tools.list_media = tool({
    description: 'List the user\'s recent generated images and edited videos with URLs.',
    inputSchema: z.object({ kind: z.enum(['image', 'video']).optional() }),
    execute: async ({ kind }) => {
      const items = (await platform.listMedia(userId, kind)).slice(0, 20);
      return items.length ? items.map((m) => `${m.kind} | ${m.createdAt} | ${m.prompt || ''} | ${m.url}`).join('\n') : 'No media yet.';
    },
  });

  const inventory = [
    canImage ? 'Images: use generate_image; show the returned markdown image in your reply.' : 'Image generation is unavailable (no image provider configured).',
    canVideo ? 'Video: use edit_video / transcribe_video with a public video URL (the user uploads files via the paperclip; uploaded files arrive as URLs). For motion graphics from nothing: generate_image, then animate_image (zoom/pan, fades, text) — say plainly that this is a camera-move animation, not frame-by-frame animation.' : 'Video editing is unavailable (no sandbox).',
  ].join('\n');
  return { tools, inventory };
}
