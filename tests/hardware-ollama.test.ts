import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectLocalHardware } from '@/lib/hardware/detector';
import { checkOllamaLiveness } from '@/lib/execution/adapters/ollama';
import { DbRepo } from '@/lib/db/repo';
import { resolveTaskRoute } from '@/lib/routing/router';
import { classifyTask } from '@/lib/routing/classifier';
import type { User } from '@/lib/types';

describe('Hardware Detection & Local Ollama Engine Tests', () => {
  const dummyUser: User = {
    id: 'test_user_hw',
    email: 'test@example.com',
    role: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('detects system memory and classifies into hardware tiers with recommendations', () => {
    const profile = detectLocalHardware();
    assert.ok(profile.ramGB > 0);
    assert.ok(profile.cpuCores > 0);
    assert.ok(['tier_1_low', 'tier_2_medium', 'tier_3_high'].includes(profile.tier));
    assert.ok(profile.recommendedModels.length > 0);
    assert.ok(profile.recommendedModels[0].modelId.includes(':'));
  });

  it('checks Ollama runtime liveness on loopback port 11434', async () => {
    const status = await checkOllamaLiveness();
    assert.strictEqual(typeof status.active, 'boolean');
    assert.ok(Array.isArray(status.models));
  });

  it('supports pinning local Ollama models in task routing at zero cost', async () => {
    const repo = new DbRepo();
    const spec = classifyTask('write a quicksort in C++', {
      pinnedRouteId: 'route_ollama_qwen2_5_coder_7b',
    });
    const resolution = await resolveTaskRoute(spec, dummyUser, repo);

    assert.strictEqual(resolution.selectedModel.id, 'model_ollama_qwen2_5_coder_7b');
    assert.strictEqual(resolution.selectedProvider.id, 'ollama');
    assert.strictEqual(resolution.selectedRoute.costClass, 'local_compute');
    assert.strictEqual(resolution.selectedRoute.pricing?.inputPer1M, 0);
  });
});
