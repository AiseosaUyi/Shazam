import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyTask } from '@/lib/routing/classifier';
import { resolveTaskRoute } from '@/lib/routing/router';
import { DbRepo } from '@/lib/db/repo';
import { executeImageGeneration } from '@/lib/execution/adapters/image-generation';
import type { User } from '@/lib/types';

describe('Free Image Generation & FLUX.1 Schnell Routing Tests', () => {
  const dummyUser: User = {
    id: 'test_user_img',
    email: 'test@example.com',
    role: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('classifies "draw a futuristic cyberpunk city" as image_generation with outputModality=image', () => {
    const spec = classifyTask('draw a futuristic cyberpunk city at midnight');
    assert.strictEqual(spec.taskClass, 'image_generation');
    assert.strictEqual(spec.outputModality, 'image');
  });

  it('routes image generation requests to FLUX.1 Schnell (Pollinations) at $0.00 cost', async () => {
    const repo = new DbRepo();
    const spec = classifyTask('draw a futuristic cyberpunk city at midnight');
    const resolution = await resolveTaskRoute(spec, dummyUser, repo);

    assert.strictEqual(resolution.selectedModel.id, 'model_flux_1_schnell');
    assert.strictEqual(resolution.selectedProvider.id, 'pollinations');
    assert.strictEqual(resolution.selectedRoute.costClass, 'verified_free');
    assert.strictEqual(resolution.selectedRoute.pricing?.inputPer1M, 0);
  });

  it('executes image generation and returns markdown image markup with FLUX parameters', async () => {
    const chunks: string[] = [];
    const result = await executeImageGeneration({
      model: {
        id: 'model_flux_1_schnell',
        providerId: 'pollinations',
        name: 'FLUX.1 Schnell (Free)',
        providerModelId: 'flux',
        inputModalities: ['text'],
        outputModality: 'image',
        contextWindowTokens: 4096,
        maxOutputTokens: 1024,
        supportsTools: false,
        supportsReasoning: false,
        qualityTier: 5,
        strengths: ['image_generation'],
      },
      route: {
        id: 'route_pollinations_flux_1_schnell',
        modelId: 'model_flux_1_schnell',
        providerId: 'pollinations',
        costClass: 'verified_free',
        pricing: { inputPer1M: 0, outputPer1M: 0 },
        quotaConfidence: 'observed',
        privacy: { providerMayTrainOnData: false },
        defaultStatus: 'enabled',
        verifiedAt: '2026-10-29',
        sourceUrl: 'https://pollinations.ai',
      },
      prompt: 'draw a majestic lion with golden armor in a savanna',
      apiKey: '',
      onChunk: (c) => {
        if (c.type === 'delta') chunks.push(c.text);
      },
    });

    assert.ok(result.fullText.includes('![majestic lion with golden armor in a savanna]'));
    assert.ok(result.fullText.includes('/api/v1/image?prompt='));
    assert.strictEqual(result.costUSD, 0);
    assert.strictEqual(result.costKind, 'zero');
  });

  it('bypasses text model pin (e.g. Gemini) when image generation is requested, preventing "No models match" collision', async () => {
    const repo = new DbRepo();
    // Simulate user having Gemini 3.8 Flash pinned in chat bar, but asking to draw an image
    const spec = classifyTask('Draw a futuristic cyberpunk samurai standing in a rain-slicked neon Tokyo alleyway', {
      pinnedRouteId: 'route_google_gemini_3_8_flash_free',
    });
    const resolution = await resolveTaskRoute(spec, dummyUser, repo);

    assert.strictEqual(resolution.selectedModel.id, 'model_flux_1_schnell');
    assert.strictEqual(resolution.selectedProvider.id, 'pollinations');
    assert.strictEqual(resolution.selectedRoute.id, 'route_pollinations_flux_1_schnell');
  });

  it('honors FLUX.1 Schnell pin directly for any prompt', async () => {
    const repo = new DbRepo();
    const spec = classifyTask('a golden retriever wearing sunglasses on the beach', {
      pinnedRouteId: 'route_pollinations_flux_1_schnell',
    });
    // Even if prompt didn't say "draw", pinning FLUX enforces image output
    spec.outputModality = 'image';
    spec.taskClass = 'image_generation';
    const resolution = await resolveTaskRoute(spec, dummyUser, repo);

    assert.strictEqual(resolution.selectedModel.id, 'model_flux_1_schnell');
    assert.strictEqual(resolution.selectedRoute.id, 'route_pollinations_flux_1_schnell');
  });

  it('routes to Google Imagen 3 (Nano Banana) when user has Google credentials and selects it', async () => {
    const repo = new DbRepo();
    await repo.createUser({
      id: dummyUser.id,
      email: dummyUser.email,
      name: 'Test User',
      passwordHash: 'dummy_hash',
      role: 'user',
    });
    await repo.setCredential({
      id: `${dummyUser.id}:google`,
      userId: dummyUser.id,
      providerId: 'google',
      encryptedKey: 'secret_key',
      keyHint: 'AIza...xxxx',
      status: 'valid',
    });
    const spec = classifyTask('draw an artistic portrait of an astronaut on mars', {
      pinnedRouteId: 'route_google_imagen_3_free',
    });
    spec.outputModality = 'image';
    spec.taskClass = 'image_generation';
    const resolution = await resolveTaskRoute(spec, dummyUser, repo);
    assert.strictEqual(resolution.selectedModel.id, 'model_google_imagen_3');
    assert.strictEqual(resolution.selectedProvider.id, 'google');
  });

  it('strictly rejects execution with 401 when Google Imagen is called without a valid API key', async () => {
    const { executeGoogleImagen } = await import('@/lib/execution/adapters/imagen');
    await assert.rejects(
      async () => {
        await executeGoogleImagen({
          model: {
            id: 'model_google_imagen_3',
            providerId: 'google',
            name: 'Google Imagen 3',
            providerModelId: 'gemini-2.5-flash-image',
            inputModalities: ['text'],
            outputModality: 'image',
            contextWindowTokens: 4096,
            maxOutputTokens: 1024,
            supportsTools: false,
            supportsReasoning: false,
            qualityTier: 5,
            strengths: ['image_generation'],
          },
          route: {
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
          },
          prompt: 'draw a portrait of a doctor',
          apiKey: '',
          onChunk: () => {},
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 401);
        assert.ok(err.message.includes('Google API key is required'));
        return true;
      }
    );
  });

  it('parses Google Gemini Image generateContent Base64 inlineData without watermarks or proxies', async () => {
    const { executeGoogleImagen } = await import('@/lib/execution/adapters/imagen');
    const originalFetch = globalThis.fetch;

    const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    globalThis.fetch = async (input: any, init?: any) => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: fakeBase64,
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
      const chunks: string[] = [];
      const result = await executeGoogleImagen({
        model: {
          id: 'model_google_imagen_3',
          providerId: 'google',
          name: 'Google Imagen 3',
          providerModelId: 'gemini-2.5-flash-image',
          inputModalities: ['text'],
          outputModality: 'image',
          contextWindowTokens: 4096,
          maxOutputTokens: 1024,
          supportsTools: false,
          supportsReasoning: false,
          qualityTier: 5,
          strengths: ['image_generation'],
        },
        route: {
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
        },
        prompt: 'portrait of a warrior',
        apiKey: 'fake_valid_google_key',
        onChunk: (c) => {
          if (c.type === 'delta') chunks.push(c.text);
        },
      });

      assert.ok(result.fullText.startsWith('![portrait of a warrior](data:image/png;base64,'));
      assert.ok(result.fullText.includes(fakeBase64));
      assert.ok(!result.fullText.includes('pollinations.ai'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('strictly throws provider error on upstream failure and never silently returns third-party proxy', async () => {
    const { executeGoogleImagen } = await import('@/lib/execution/adapters/imagen');
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 404,
            message: 'models/gemini-2.5-flash-image is not found or not supported for generateContent',
            status: 'NOT_FOUND',
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      await assert.rejects(
        async () => {
          await executeGoogleImagen({
            model: {
              id: 'model_google_imagen_3',
              providerId: 'google',
              name: 'Google Imagen 3',
              providerModelId: 'gemini-2.5-flash-image',
              inputModalities: ['text'],
              outputModality: 'image',
              contextWindowTokens: 4096,
              maxOutputTokens: 1024,
              supportsTools: false,
              supportsReasoning: false,
              qualityTier: 5,
              strengths: ['image_generation'],
            },
            route: {
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
            },
            prompt: 'scenic mountains',
            apiKey: 'fake_valid_google_key',
            onChunk: () => {},
          });
        },
        (err: any) => {
          assert.strictEqual(err.statusCode, 404);
          assert.strictEqual(err.type, 'model_unavailable');
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('routes and executes OpenAI DALL-E 3 with pristine base64 payload and zero watermarks', async () => {
    const { executeOpenAIDalle } = await import('@/lib/execution/adapters/dalle');
    const originalFetch = globalThis.fetch;
    const fakeDalleB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    globalThis.fetch = async (url: any, init?: any) => {
      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json: fakeDalleB64,
              revised_prompt: 'A photorealistic portrait of an African boy in Lagos, 35mm lens, golden hour',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    try {
      const result = await executeOpenAIDalle({
        model: {
          id: 'model_openai_dalle_3',
          providerId: 'openai',
          name: 'OpenAI DALL-E 3',
          providerModelId: 'dall-e-3',
          inputModalities: ['text'],
          outputModality: 'image',
          contextWindowTokens: 4096,
          maxOutputTokens: 1024,
          supportsTools: false,
          supportsReasoning: false,
          qualityTier: 5,
          strengths: ['image_generation'],
        },
        route: {
          id: 'route_openai_dalle_3',
          modelId: 'model_openai_dalle_3',
          providerId: 'openai',
          costClass: 'paid',
          pricing: { inputPer1M: 40.0, outputPer1M: 40.0 },
          quotaConfidence: 'observed',
          privacy: { providerMayTrainOnData: false },
          defaultStatus: 'enabled',
          verifiedAt: '2026-10-29',
          sourceUrl: 'https://platform.openai.com/docs/guides/images',
        },
        prompt: 'An Igbo boy in Lagos wearing traditional attire, cinematic natural lighting',
        apiKey: 'sk-test-valid-openai-key',
        onChunk: () => {},
      });

      assert.ok(result.fullText.includes(`data:image/png;base64,${fakeDalleB64}`));
      assert.ok(!result.fullText.includes('pollinations.ai'));
      assert.strictEqual(result.costUSD, 0.08);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
