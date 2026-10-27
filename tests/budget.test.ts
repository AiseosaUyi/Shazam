import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { filterCandidates } from '@/lib/routing/candidate-filter';
import { getLiveCatalog } from '@/lib/catalog';
import type { TaskSpec } from '@/lib/types';

describe('Budget & Per-Task Cap Enforcement Tests', () => {
  it('blocks routes whose estimated cost exceeds the per-task cap', async () => {
    const repo = createTestRepo();
    const catalog = await getLiveCatalog(repo);

    const modelMap = new Map(catalog.models.map((m) => [m.id, m]));
    const providerMap = new Map(catalog.providers.map((p) => [p.id, p]));

    // Extremely low perTaskCapUSD = $0.0001
    const taskSpec: TaskSpec = {
      taskClass: 'coding',
      costPolicy: 'best_quality',
      contextEstimateTokens: 1000,
      expectedOutputTokens: 2000,
      inputModalities: ['text'],
      outputModality: 'text',
      requiredCapabilities: [],
      privacyMode: 'standard',
      maxCostUSD: 0.00001, // 0.001 cents
      monthlyBudgetRemainingUSD: 50.0,
      allowedProviders: null,
      pinnedRouteId: null,
      classifierConfidence: 'keyword',
    };

    const context = {
      taskSpec,
      models: modelMap,
      providers: providerMap,
      userCredentials: new Set(['openai', 'google', 'anthropic']),
      systemKeysAvailable: new Set<string>(),
      canUseSystemKeys: false,
      activeCooldowns: new Map<string, string>(),
    };

    const { eligible, rejected } = filterCandidates(catalog.routes, context);

    // Paid routes must be rejected due to per-task cap
    const paidRejections = rejected.filter((r) =>
      r.rejection?.includes('exceeds per-task cap')
    );
    assert.ok(paidRejections.length > 0, 'Paid routes should be rejected due to per-task cap');

    for (const el of eligible) {
      assert.strictEqual(el.costClass, 'verified_free');
    }
  });

  it('blocks routes when estimated cost would exceed remaining monthly budget', async () => {
    const repo = createTestRepo();
    const catalog = await getLiveCatalog(repo);

    const modelMap = new Map(catalog.models.map((m) => [m.id, m]));
    const providerMap = new Map(catalog.providers.map((p) => [p.id, p]));

    // Remaining monthly budget is $0.00005
    const taskSpec: TaskSpec = {
      taskClass: 'reasoning',
      costPolicy: 'best_quality',
      contextEstimateTokens: 2000,
      expectedOutputTokens: 3000,
      inputModalities: ['text'],
      outputModality: 'text',
      requiredCapabilities: [],
      privacyMode: 'standard',
      maxCostUSD: 10.0,
      monthlyBudgetRemainingUSD: 0.00005, // Almost depleted budget
      allowedProviders: null,
      pinnedRouteId: null,
      classifierConfidence: 'keyword',
    };

    const context = {
      taskSpec,
      models: modelMap,
      providers: providerMap,
      userCredentials: new Set(['openai', 'google', 'anthropic']),
      systemKeysAvailable: new Set<string>(),
      canUseSystemKeys: false,
      activeCooldowns: new Map<string, string>(),
    };

    const { eligible, rejected } = filterCandidates(catalog.routes, context);

    const budgetRejections = rejected.filter((r) =>
      r.rejection?.includes('exceeds remaining monthly budget')
    );
    assert.ok(budgetRejections.length > 0, 'Paid routes must be rejected when monthly budget is exhausted');
  });
});
