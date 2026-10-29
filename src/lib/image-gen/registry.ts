/**
 * Image Generation Provider & Model Capability Registry
 * 
 * Defines verified technical capabilities, endpoints, pricing tiers,
 * aspect ratios, and resolutions across supported image generation backends.
 */

export type ImageProviderId = 'google' | 'cloudflare' | 'huggingface' | 'openrouter' | 'pollinations' | 'openai';

export type ImageAspectRatios = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9';
export type ImageResolution = '512' | '1K' | '2K' | '4K';

export interface ImageModelCapability {
  id: string;
  providerId: ImageProviderId;
  name: string;
  providerModelId: string;
  description: string;
  endpoint: string;
  authHeader: string;
  supportsTextToImage: boolean;
  supportsImageToImage: boolean;
  supportsReferenceImages: boolean;
  supportsInpainting: boolean;
  supportsTextRendering: boolean;
  supportedAspectRatios: ImageAspectRatios[];
  supportedResolutions: ImageResolution[];
  defaultAspectRatio: ImageAspectRatios;
  defaultResolution: ImageResolution;
  costClass: 'verified_free' | 'byok_free_tier' | 'paid' | 'zero_key';
  requiresApiKey: boolean;
  keyPortalUrl?: string;
  estimatedCostPerImageUSD: number;
  qualityScore: number; // 1-5 rubric
  anatomyFidelityScore: number; // 1-5 rubric
  watermarkPolicy: 'none' | 'synthid_invisible' | 'third_party_visible';
  notes: string;
  verificationDate: string;
}

export const IMAGE_CAPABILITIES_REGISTRY: Record<string, ImageModelCapability> = {
  // Google Official Gemini API / Nano Banana
  'gemini-3.1-flash-image': {
    id: 'gemini-3.1-flash-image',
    providerId: 'google',
    name: 'Google Nano Banana 2.1 (Flash Image)',
    providerModelId: 'gemini-3.1-flash-image',
    description: 'Google AI Studio high-efficiency multimodal image model. Exceptional human anatomy, natural skin tones, and sharp typography.',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
    authHeader: 'x-goog-api-key',
    supportsTextToImage: true,
    supportsImageToImage: true,
    supportsReferenceImages: true,
    supportsInpainting: true,
    supportsTextRendering: true,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    supportedResolutions: ['512', '1K', '2K', '4K'],
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    costClass: 'byok_free_tier',
    requiresApiKey: true,
    keyPortalUrl: 'https://aistudio.google.com/app/apikey',
    estimatedCostPerImageUSD: 0.00,
    qualityScore: 5,
    anatomyFidelityScore: 5,
    watermarkPolicy: 'synthid_invisible',
    notes: 'Free evaluation tier available via standard Google AI Studio developer keys. Invisible SynthID watermarking included.',
    verificationDate: '2026-10-29',
  },
  'gemini-3-pro-image': {
    id: 'gemini-3-pro-image',
    providerId: 'google',
    name: 'Google Nano Banana Pro (Gemini 3 Pro Image)',
    providerModelId: 'gemini-3-pro-image',
    description: 'Flagship reasoning and image generation model. Unmatched prompt adherence, complex multi-character composition, and photo realism.',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
    authHeader: 'x-goog-api-key',
    supportsTextToImage: true,
    supportsImageToImage: true,
    supportsReferenceImages: true,
    supportsInpainting: true,
    supportsTextRendering: true,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'],
    supportedResolutions: ['1K', '2K', '4K'],
    defaultAspectRatio: '1:1',
    defaultResolution: '2K',
    costClass: 'byok_free_tier',
    requiresApiKey: true,
    keyPortalUrl: 'https://aistudio.google.com/app/apikey',
    estimatedCostPerImageUSD: 0.03,
    qualityScore: 5,
    anatomyFidelityScore: 5,
    watermarkPolicy: 'synthid_invisible',
    notes: 'Premium reasoning and generative vision model. Ideal for complex lighting, fine textures, and hands.',
    verificationDate: '2026-10-29',
  },

  // Cloudflare Workers AI Serverless
  'cf-flux-1-schnell': {
    id: 'cf-flux-1-schnell',
    providerId: 'cloudflare',
    name: 'Cloudflare FLUX.1 Schnell (Hosted)',
    providerModelId: '@cf/black-forest-labs/flux-1-schnell',
    description: 'Black Forest Labs 12B parameter rectified flow transformer hosted serverless on Cloudflare Workers AI.',
    endpoint: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/black-forest-labs/flux-1-schnell',
    authHeader: 'Authorization: Bearer',
    supportsTextToImage: true,
    supportsImageToImage: false,
    supportsReferenceImages: false,
    supportsInpainting: false,
    supportsTextRendering: true,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3'],
    supportedResolutions: ['512', '1K'],
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    costClass: 'byok_free_tier',
    requiresApiKey: true,
    keyPortalUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    estimatedCostPerImageUSD: 0.00,
    qualityScore: 4,
    anatomyFidelityScore: 4,
    watermarkPolicy: 'none',
    notes: 'Free daily Neurons quota included on Cloudflare standard accounts. Zero third-party logos or watermarks.',
    verificationDate: '2026-10-29',
  },

  // Hugging Face Serverless Inference
  'hf-flux-1-schnell': {
    id: 'hf-flux-1-schnell',
    providerId: 'huggingface',
    name: 'Hugging Face FLUX.1 Schnell',
    providerModelId: 'black-forest-labs/FLUX.1-schnell',
    description: 'Hosted direct serverless inference for FLUX.1 Schnell via Hugging Face Inference API.',
    endpoint: 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    authHeader: 'Authorization: Bearer',
    supportsTextToImage: true,
    supportsImageToImage: false,
    supportsReferenceImages: false,
    supportsInpainting: false,
    supportsTextRendering: true,
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
    supportedResolutions: ['1K'],
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    costClass: 'byok_free_tier',
    requiresApiKey: true,
    keyPortalUrl: 'https://huggingface.co/settings/tokens',
    estimatedCostPerImageUSD: 0.00,
    qualityScore: 4,
    anatomyFidelityScore: 4,
    watermarkPolicy: 'none',
    notes: 'Free monthly inference allowance for community tokens. High fidelity direct raw PNG response.',
    verificationDate: '2026-10-29',
  },

  // Zero-Key Fallback (Pollinations AI)
  'pollinations-flux-1-schnell': {
    id: 'pollinations-flux-1-schnell',
    providerId: 'pollinations',
    name: 'FLUX.1 Schnell (Community Gateway)',
    providerModelId: 'flux',
    description: 'Instant zero-key image generation for quick testing and fallback when no BYOK keys are configured.',
    endpoint: 'https://image.pollinations.ai/prompt/{prompt}',
    authHeader: '',
    supportsTextToImage: true,
    supportsImageToImage: false,
    supportsReferenceImages: false,
    supportsInpainting: false,
    supportsTextRendering: false,
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
    supportedResolutions: ['1K'],
    defaultAspectRatio: '1:1',
    defaultResolution: '1K',
    costClass: 'zero_key',
    requiresApiKey: false,
    estimatedCostPerImageUSD: 0.00,
    qualityScore: 3,
    anatomyFidelityScore: 3,
    watermarkPolicy: 'third_party_visible',
    notes: 'Public community gateway. Automatically enhanced with negative human prompt tokens to prevent anatomical distortion.',
    verificationDate: '2026-10-29',
  },
};

export function getImageCapability(modelIdOrProviderModelId: string): ImageModelCapability | undefined {
  if (IMAGE_CAPABILITIES_REGISTRY[modelIdOrProviderModelId]) {
    return IMAGE_CAPABILITIES_REGISTRY[modelIdOrProviderModelId];
  }
  return Object.values(IMAGE_CAPABILITIES_REGISTRY).find(
    (c) => c.providerModelId === modelIdOrProviderModelId || c.id === modelIdOrProviderModelId
  );
}
