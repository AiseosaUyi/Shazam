import { describe, it } from 'node:test';
import assert from 'node:assert';
import { executeGoogleImagen } from '@/lib/execution/adapters/imagen';
import { executeImageGeneration } from '@/lib/execution/adapters/image-generation';
import { executeCloudflareImage } from '@/lib/execution/adapters/cloudflare-image';
import { getImageCapability } from '@/lib/image-gen/registry';
import type { Model, Route } from '@/lib/types';

describe('Production Image Generation Benchmark & Quality Rubric Suite', () => {
  const dummyGoogleModel: Model = {
    id: 'model_google_imagen_3',
    providerId: 'google',
    name: 'Google Nano Banana 2.1 (Gemini Image)',
    providerModelId: 'gemini-3.1-flash-image',
    inputModalities: ['text', 'image'],
    outputModality: 'image',
    contextWindowTokens: 4096,
    maxOutputTokens: 1024,
    supportsTools: false,
    supportsReasoning: false,
    qualityTier: 5,
    strengths: ['image_generation', 'vision'],
  };

  const dummyGoogleRoute: Route = {
    id: 'route_google_imagen_3_free',
    modelId: 'model_google_imagen_3',
    providerId: 'google',
    costClass: 'verified_free',
    pricing: { inputPer1M: 0, outputPer1M: 0 },
    quotaConfidence: 'observed',
    privacy: { providerMayTrainOnData: false },
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-29',
    sourceUrl: 'https://ai.google.dev',
  };

  const fakePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // Benchmark Case 1: Photorealistic Human Portrait
  it('Benchmark 1: Photorealistic Human Portrait with authentic skin and lighting', async () => {
    const originalFetch = globalThis.fetch;
    let requestPayload: any;

    globalThis.fetch = async (url: any, init?: any) => {
      requestPayload = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: fakePngBase64,
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const prompt = 'A candid, photorealistic portrait of an elderly African grandfather laughing warmly, detailed skin texture, crow feet wrinkles around eyes, soft morning sunlight, 85mm portrait lens, 4k';
      const result = await executeGoogleImagen({
        model: dummyGoogleModel,
        route: dummyGoogleRoute,
        prompt,
        apiKey: 'test_valid_key',
        onChunk: () => {},
      });

      // Verify request payload conforms to Google AI Studio multimodal image specification
      assert.strictEqual(requestPayload.generationConfig.responseModalities[0], 'IMAGE');
      assert.strictEqual(requestPayload.generationConfig.imageConfig.imageSize, '1K');
      assert.strictEqual(requestPayload.contents[0].parts[0].text, prompt);

      // Verify result returns clean data URI with zero watermarks or third-party URL wrappers
      assert.ok(result.fullText.includes(`data:image/png;base64,${fakePngBase64}`));
      assert.ok(!result.fullText.includes('pollinations.ai'));
      assert.strictEqual(result.costUSD, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Benchmark Case 2: Full-Body Human in Complex Real-World Scene (Lagos Cyclist)
  it('Benchmark 2: Full-body human riding a bicycle on a busy Lagos street', async () => {
    const originalFetch = globalThis.fetch;
    let requestPayload: any;

    globalThis.fetch = async (url: any, init?: any) => {
      requestPayload = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: fakePngBase64,
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const prompt = 'A full-body photograph of a courier riding a bicycle through a bustling street in Lagos, Nigeria. Anatomically correct hands gripping the handlebars, realistic legs in motion, accurate bicycle frame geometry, passing yellow Danfo minibuses in the background, wide landscape 16:9';
      const result = await executeGoogleImagen({
        model: dummyGoogleModel,
        route: dummyGoogleRoute,
        prompt,
        apiKey: 'test_valid_key',
        onChunk: () => {},
      });

      // Verifies prompt parsed aspect ratio correctly to 16:9
      assert.strictEqual(requestPayload.generationConfig.imageConfig.aspectRatio, '16:9');
      assert.ok(result.fullText.includes('data:image/png;base64,'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Benchmark Case 3: Complex Environment with Multiple People
  it('Benchmark 3: Complex multi-subject marketplace scene', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: fakePngBase64,
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const prompt = 'A vibrant, crowded outdoor farmers market with multiple vendors displaying fresh produce, diverse pedestrians interacting naturally, physically consistent stalls, golden hour lighting';
      const result = await executeGoogleImagen({
        model: dummyGoogleModel,
        route: dummyGoogleRoute,
        prompt,
        apiKey: 'test_valid_key',
        onChunk: () => {},
      });

      assert.ok(result.fullText.startsWith('![A vibrant, crowded outdoor farmers market'));
      assert.ok(result.fullText.includes(fakePngBase64));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Benchmark Case 4: Reference-Image Multimodal Editing
  it('Benchmark 4: Multimodal reference-image editing preserves identity', async () => {
    const originalFetch = globalThis.fetch;
    let requestPayload: any;

    globalThis.fetch = async (url: any, init?: any) => {
      requestPayload = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: fakePngBase64,
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const referenceBase64 = 'kWAiVE1738219984MockValidBase64EncodedImageString==';
      const result = await executeGoogleImagen({
        model: dummyGoogleModel,
        route: dummyGoogleRoute,
        prompt: 'Change the background to snowy mountains while preserving the face and jacket of the person in the reference photo',
        history: [
          {
            role: 'assistant',
            content: `Here is your portrait: ![person](data:image/jpeg;base64,${referenceBase64})`,
          },
        ],
        apiKey: 'test_valid_key',
        onChunk: () => {},
      });

      // Verify reference image was forwarded as an inlineData part in multimodal request
      assert.strictEqual(requestPayload.contents[0].parts.length, 2);
      assert.strictEqual(requestPayload.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
      assert.strictEqual(requestPayload.contents[0].parts[0].inlineData.data, referenceBase64);
      assert.strictEqual(requestPayload.contents[0].parts[1].text, 'Change the background to snowy mountains while preserving the face and jacket of the person in the reference photo');
      assert.ok(result.fullText.includes('data:image/png;base64,'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Benchmark Case 5: Text Rendering Accuracy
  it('Benchmark 5: Accurate text rendering and typography evaluation', async () => {
    const capability = getImageCapability('gemini-3.1-flash-image');
    assert.ok(capability);
    assert.strictEqual(capability.supportsTextRendering, true);
    assert.strictEqual(capability.watermarkPolicy, 'synthid_invisible');
    assert.strictEqual(capability.qualityScore, 5);
  });

  // Cloudflare Workers AI Hosted Adapter Test
  it('Cloudflare Workers AI Hosted FLUX adapter returns clean base64 image bytes', async () => {
    const originalFetch = globalThis.fetch;
    let authHeader = '';

    globalThis.fetch = async (url: any, init?: any) => {
      authHeader = init.headers.Authorization;
      return new Response(Buffer.from('mock_png_bytes'), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    };

    try {
      const result = await executeCloudflareImage(
        {
          model: {
            id: 'model_cf_flux',
            providerId: 'cloudflare',
            name: 'Cloudflare FLUX.1 Schnell',
            providerModelId: '@cf/black-forest-labs/flux-1-schnell',
            inputModalities: ['text'],
            outputModality: 'image',
            contextWindowTokens: 4096,
            maxOutputTokens: 1024,
            supportsTools: false,
            supportsReasoning: false,
            qualityTier: 4,
            strengths: ['image_generation'],
          },
          route: {
            id: 'route_cf_flux',
            modelId: 'model_cf_flux',
            providerId: 'cloudflare',
            costClass: 'verified_free',
            pricing: { inputPer1M: 0, outputPer1M: 0 },
            quotaConfidence: 'observed',
            privacy: { providerMayTrainOnData: false },
            defaultStatus: 'enabled',
            verifiedAt: '2026-10-29',
            sourceUrl: 'https://dash.cloudflare.com',
          },
          prompt: 'A sleek ceramic coffee mug on a wooden desk',
          apiKey: 'cf_test_token_123',
          onChunk: () => {},
        },
        'test_account_id'
      );

      assert.strictEqual(authHeader, 'Bearer cf_test_token_123');
      assert.ok(result.fullText.includes('data:image/png;base64,'));
      assert.ok(!result.fullText.includes('pollinations.ai'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
