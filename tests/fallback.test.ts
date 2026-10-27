import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { determineFallback } from '@/lib/routing/router';
import { classifyPrompt } from '@/lib/routing/classifier';
import { setTestEnv } from '@/lib/env';
import type { User, ProviderError, CatalogRoute } from '@/lib/types';

describe('Fallback Behavior Tests', () => {
  setTestEnv({
    GOOGLE_AI_API_KEY: 'test-google-key',
    OPENAI_API_KEY: 'test-openai-key',
    SHAZAM_SHARE_SYSTEM_KEYS: 'true',
  });

  const testUser: User = {
    id: 'user_fallback_tester',
    email: 'fallback@shazam.ai',
    name: 'Fallback Tester',
    role: 'user',
    status: 'active',
    onboarded: true,
    createdAt: new Date().toISOString(),
  };

  const sampleRoute: CatalogRoute = {
    id: 'openai:gpt-6.1-terra',
    modelId: 'gpt-6.1-terra',
    providerId: 'openai',
    costClass: 'paid',
    status: 'enabled',
    pricing: { inputPer1M: 1, outputPer1M: 5 },
    privacy: { providerMayTrainOnData: false },
    quotaConfidence: 'unknown',
    defaultStatus: 'enabled',
    verifiedAt: '2026-10-27',
    sourceUrl: 'https://openai.com',
  };

  it('stops immediately with NO fallback on content_policy violation', async () => {
    const repo = createTestRepo();
    const taskSpec = {
      ...classifyPrompt('Help me write content'),
      costPolicy: 'balanced' as const,
      privacyMode: 'standard' as const,
      maxCostUSD: 1.0,
      monthlyBudgetRemainingUSD: 10.0,
      pinnedRouteId: null,
      allowedProviders: null,
    };

    const policyError: ProviderError = {
      message: 'Blocked by provider safety filter',
      type: 'content_policy',
      statusCode: 400,
      retryable: false,
    };

    const fallback = await determineFallback(taskSpec, sampleRoute, policyError, testUser, repo, []);
    assert.strictEqual(fallback, null, 'content_policy must never trigger fallback');
  });

  it('marks credential invalid upon 401 invalid_credentials', async () => {
    const repo = createTestRepo();
    await repo.createUser({
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
      passwordHash: 'dummy',
      role: 'user',
    });
    await repo.setCredential({
      id: `${testUser.id}:openai`,
      userId: testUser.id,
      providerId: 'openai',
      encryptedKey: 'dummy-encrypted-key',
      keyHint: 'sk-...1234',
      status: 'valid',
    });

    const taskSpec = {
      ...classifyPrompt('Test auth'),
      costPolicy: 'balanced' as const,
      privacyMode: 'standard' as const,
      maxCostUSD: 1.0,
      monthlyBudgetRemainingUSD: 10.0,
      pinnedRouteId: null,
      allowedProviders: null,
    };

    const authError: ProviderError = {
      message: 'Incorrect API key provided',
      type: 'invalid_credentials',
      statusCode: 401,
      retryable: false,
    };

    await determineFallback(taskSpec, sampleRoute, authError, testUser, repo, []);

    const updatedCred = await repo.getCredential(testUser.id, 'openai');
    assert.strictEqual(updatedCred?.status, 'invalid', '401 must mark credential status as invalid');
  });

  it('sets user or global cooldown upon 429 rate limit with Retry-After', async () => {
    const repo = createTestRepo();
    const taskSpec = {
      ...classifyPrompt('Test rate limit'),
      costPolicy: 'balanced' as const,
      privacyMode: 'standard' as const,
      maxCostUSD: 1.0,
      monthlyBudgetRemainingUSD: 10.0,
      pinnedRouteId: null,
      allowedProviders: null,
    };

    const rateLimitError: ProviderError = {
      message: 'Rate limit exceeded',
      type: 'rate_limited',
      statusCode: 429,
      retryable: true,
      retryAfterSeconds: 45,
    };

    await determineFallback(taskSpec, sampleRoute, rateLimitError, testUser, repo, []);

    const health = await repo.getRouteHealth(sampleRoute.id, 'global');
    assert.ok(health?.cooldownUntil);
    const cooldownTime = new Date(health.cooldownUntil).getTime();
    assert.ok(cooldownTime > Date.now() + 30000);
  });
});
