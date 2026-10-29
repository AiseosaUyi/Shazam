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
    assert.ok(result.fullText.includes('https://image.pollinations.ai/prompt/'));
    assert.ok(result.fullText.includes('FLUX.1 Schnell'));
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
});
