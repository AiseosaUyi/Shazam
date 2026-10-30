import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyTask } from '@/lib/routing/classifier';
import { resolveTaskRoute } from '@/lib/routing/router';
import { DbRepo } from '@/lib/db/repo';
import type { User } from '@/lib/types';

describe('Free Image Generation & FLUX.2 klein Routing Tests', () => {
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

  it('routes image requests to the free FLUX.2 klein platform model at $0.00 with no key', async () => {
    const repo = new DbRepo();
    const resolution = await resolveTaskRoute(classifyTask('draw a futuristic cyberpunk city at midnight'), dummyUser, repo);
    assert.strictEqual(resolution.selectedModel.id, 'model_gateway_flux_2_klein');
    assert.strictEqual(resolution.selectedProvider.id, 'gateway');
    assert.strictEqual(resolution.selectedRoute.costClass, 'verified_free');
  });

  it('bypasses a pinned text model when an image is requested', async () => {
    const repo = new DbRepo();
    const spec = classifyTask('Draw a futuristic cyberpunk samurai in a neon Tokyo alleyway', { pinnedRouteId: 'route_google_gemini_3_8_flash_free' });
    const resolution = await resolveTaskRoute(spec, dummyUser, repo);
    assert.strictEqual(resolution.selectedModel.outputModality, 'image');
  });

  it('no longer offers the low-quality Pollinations FLUX.1 schnell route', async () => {
    const { STATIC_ROUTES } = await import('@/lib/catalog');
    assert.ok(!STATIC_ROUTES.some((r) => r.providerId === 'pollinations'));
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
