import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { resolveTaskRoute, determineFallback } from '@/lib/routing/router';
import { classifyPrompt } from '@/lib/routing/classifier';
import { setTestEnv } from '@/lib/env';
import type { User, ProviderError, CatalogRoute } from '@/lib/types';

describe('Model Pinning Tests', () => {
  setTestEnv({
    GOOGLE_AI_API_KEY: 'test-google-key',
    OPENAI_API_KEY: 'test-openai-key',
    SHAZAM_SHARE_SYSTEM_KEYS: 'true',
  });

  const testUser: User = {
    id: 'user_pin_tester',
    email: 'pin@shazam.ai',
    name: 'Pin Tester',
    role: 'user',
    status: 'active',
    onboarded: true,
    createdAt: new Date().toISOString(),
  };

  it('honors model pinning by model name', async () => {
    const repo = createTestRepo();
    const taskSpec = {
      ...classifyPrompt('Help me write an essay'),
      costPolicy: 'balanced' as const,
      privacyMode: 'standard' as const,
      maxCostUSD: 1.0,
      monthlyBudgetRemainingUSD: 10.0,
      pinnedRouteId: 'gemini-3.8-flash',
      allowedProviders: null,
    };

    const resolution = await resolveTaskRoute(taskSpec, testUser, repo);
    assert.strictEqual(resolution.selectedModel.name, 'Gemini 3.8 Flash');
  });

  it('strictly refuses to switch or fallback when a route/model is pinned', async () => {
    const repo = createTestRepo();
    const taskSpec = {
      ...classifyPrompt('Help me write an essay'),
      costPolicy: 'balanced' as const,
      privacyMode: 'standard' as const,
      maxCostUSD: 1.0,
      monthlyBudgetRemainingUSD: 10.0,
      pinnedRouteId: 'gemini-3.8-flash',
      allowedProviders: null,
    };

    const pinnedRoute: CatalogRoute = {
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
      message: 'Rate limit error',
      type: 'rate_limited',
      statusCode: 429,
      retryable: true,
    };

    const fallback = await determineFallback(
      taskSpec,
      pinnedRoute,
      error,
      testUser,
      repo,
      []
    );

    assert.strictEqual(fallback, null, 'A pinned route must never switch on fallback.');
  });
});
