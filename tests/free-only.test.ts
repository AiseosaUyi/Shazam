import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { resolveTaskRoute, determineFallback } from '@/lib/routing/router';
import { classifyPrompt } from '@/lib/routing/classifier';
import { setTestEnv } from '@/lib/env';
import type { User, ProviderError, CatalogRoute } from '@/lib/types';

describe('Free-Only Routing Policy Tests', () => {
  setTestEnv({
    GOOGLE_AI_API_KEY: 'test-google-key',
    OPENAI_API_KEY: 'test-openai-key',
    SHAZAM_SHARE_SYSTEM_KEYS: 'true',
  });

  const testUser: User = {
    id: 'user_free_tester',
    email: 'free@shazam.ai',
    name: 'Free Tester',
    role: 'user',
    status: 'active',
    onboarded: true,
    createdAt: new Date().toISOString(),
  };

  it('strictly selects verified_free routes with zero cost under free_only policy', async () => {
    const repo = createTestRepo();
    const taskSpec = {
      ...classifyPrompt('Help me write a concise summary of this article'),
      costPolicy: 'free_only' as const,
      privacyMode: 'standard' as const,
      maxCostUSD: 0.25,
      monthlyBudgetRemainingUSD: 10.0,
      pinnedRouteId: null,
      allowedProviders: null,
    };

    const resolution = await resolveTaskRoute(taskSpec, testUser, repo);
    assert.strictEqual(resolution.selectedRoute.costClass, 'verified_free');
    assert.strictEqual(resolution.selectedRoute.pricing?.inputPer1M, 0);
    assert.strictEqual(resolution.selectedRoute.pricing?.outputPer1M, 0);
    assert.ok(resolution.decisionTrace.rationale.includes('verified_free'));
  });

  it('never falls back from free route to a paid or unknown-cost route', async () => {
    const repo = createTestRepo();
    const taskSpec = {
      ...classifyPrompt('Draft a poem'),
      costPolicy: 'free_only' as const,
      privacyMode: 'standard' as const,
      maxCostUSD: 0.25,
      monthlyBudgetRemainingUSD: 10.0,
      pinnedRouteId: null,
      allowedProviders: null,
    };

    const failedRoute: CatalogRoute = {
      id: 'google:gemini-3.8-flash:free',
      modelId: 'gemini-3.8-flash',
      providerId: 'google',
      costClass: 'verified_free',
      status: 'enabled',
      pricing: null,
      privacy: { providerMayTrainOnData: true },
      quotaConfidence: 'observed',
      defaultStatus: 'enabled',
      verifiedAt: '2026-10-27',
      sourceUrl: 'https://ai.google.dev',
    };

    const error: ProviderError = {
      message: 'Rate limit reached',
      type: 'rate_limited',
      statusCode: 429,
      retryable: true,
      retryAfterSeconds: 30,
    };

    const fallback = await determineFallback(
      taskSpec,
      failedRoute,
      error,
      testUser,
      repo,
      ['google:gemini-3.8-flash:free', 'google:gemini-3.5-flash-lite:free']
    );

    if (fallback) {
      assert.strictEqual(fallback.selectedRoute.costClass, 'verified_free');
    } else {
      assert.strictEqual(fallback, null);
    }
  });

  it('rejects routing if free_only has no eligible verified_free routes', async () => {
    const repo = createTestRepo();
    const cooldownUntil = new Date(Date.now() + 60000).toISOString();
    await repo.setRouteCooldown('route_google_gemini_3_8_flash_free', 'global', cooldownUntil, 'rate_limited');
    await repo.setRouteCooldown('route_google_gemini_3_5_flash_lite_free', 'global', cooldownUntil, 'rate_limited');

    const taskSpec = {
      ...classifyPrompt('Quick chat'),
      costPolicy: 'free_only' as const,
      privacyMode: 'standard' as const,
      maxCostUSD: 0.25,
      monthlyBudgetRemainingUSD: 10.0,
      pinnedRouteId: null,
      allowedProviders: ['google'],
    };

    await assert.rejects(
      async () => {
        await resolveTaskRoute(taskSpec, testUser, repo);
      },
      /No eligible routes found under policy "free only"/
    );
  });
});
