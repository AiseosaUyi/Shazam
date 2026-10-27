import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { determineFallback } from '@/lib/routing/router';
import { classifyPrompt } from '@/lib/routing/classifier';
import { setTestEnv } from '@/lib/env';
import type { User, CatalogRoute } from '@/lib/types';

describe('Free route failures never fall back to paid', () => {
  setTestEnv({
    GOOGLE_AI_API_KEY: 'k1',
    OPENAI_API_KEY: 'k2',
    ANTHROPIC_API_KEY: 'k3',
    SHAZAM_SHARE_SYSTEM_KEYS: 'true',
  } as any);

  const user: User = {
    id: 'u_free_fb', email: 'f@x.com', name: 'f', role: 'user', status: 'active', onboarded: true,
    createdAt: new Date().toISOString(),
  };

  it('balanced policy + free route 429 only falls back to verified_free', async () => {
    const repo = createTestRepo();
    const failed: CatalogRoute = {
      id: 'free-route-under-test', modelId: 'x', providerId: 'google', costClass: 'verified_free',
      status: 'enabled', pricing: { inputPer1M: 0, outputPer1M: 0 }, privacy: { providerMayTrainOnData: true },
      quotaConfidence: 'unknown', defaultStatus: 'enabled', verifiedAt: '2026-10-27', sourceUrl: 'https://x',
    };
    const spec = {
      ...classifyPrompt('hello'),
      costPolicy: 'balanced' as const, privacyMode: 'standard' as const, maxCostUSD: 5,
      monthlyBudgetRemainingUSD: 50, pinnedRouteId: null, allowedProviders: null,
    };
    const fb = await determineFallback(spec, failed, { type: 'rate_limited', message: '429', statusCode: 429, retryable: true }, user, repo as any, []);
    assert.ok(fb, 'a free fallback exists');
    assert.strictEqual(fb!.selectedRoute.costClass, 'verified_free');
  });
});
