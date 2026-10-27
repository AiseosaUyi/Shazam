import { describe, it } from 'node:test';
import assert from 'node:assert';
import { db } from '@/lib/db';
import { resolveRouteForTask } from '@/lib/routing';
import { determineFallbackRoute } from '@/lib/routing/fallback-engine';
import { TaskSpec } from '@/types/core';

describe('Security: Free-Only Zero-Tolerance Policy Enforcement', () => {
  it('strictly selects only verified_free routes under free_only policy', async () => {
    db.seed();
    const resolution = await resolveRouteForTask('user_default', 'Write a hello world program in python', [], 'free_only');

    assert.strictEqual(resolution.taskSpec.costPolicy, 'free_only');
    assert.ok(
      resolution.selectedRoute.costClass === 'verified_free' || resolution.selectedRoute.costClass === 'user_allowance',
      `Selected route cost class was "${resolution.selectedRoute.costClass}", expected verified_free or user_allowance`
    );
    assert.strictEqual(resolution.selectedRoute.pricing.inputPer1MTokensUSD, 0.0);
  });

  it('rejects all paid routes during candidate filtering in free_only mode', async () => {
    db.seed();
    const resolution = await resolveRouteForTask('user_default', 'Analyze this financial report', [], 'free_only');

    for (const cand of resolution.decisionTrace.candidates) {
      if (cand.status === 'filtered_out' && cand.filterRejectionReason?.includes('Free-Only policy violation')) {
        const route = await db.getRouteById(cand.routeId);
        assert.ok(route?.costClass === 'paid' || route?.costClass === 'unknown');
      }
    }
  });

  it('ensures fallback under free_only NEVER selects a paid route', async () => {
    db.seed();
    const taskSpec: TaskSpec = {
      taskClass: 'coding',
      inputModalities: ['text'],
      outputModality: 'code',
      requiredCapabilities: ['code'],
      contextEstimateTokens: 1000,
      privacySensitivity: 'standard',
      costPolicy: 'free_only',
      maxCostUSD: 0.0,
    };

    // Simulate primary route failure (e.g. rate limit on Gemini Free route)
    const failedRouteId = 'route_google_gemini_flash_free';
    const fallback = await determineFallbackRoute(
      'user_default',
      taskSpec,
      failedRouteId,
      { type: 'rate_limited', message: '429 Too Many Requests', retryable: true, retryAfterSeconds: 30 }
    );

    assert.ok(fallback, 'Expected fallback to alternative free route');
    assert.notStrictEqual(fallback.nextRoute.id, failedRouteId);
    assert.ok(
      fallback.nextRoute.costClass === 'verified_free' || fallback.nextRoute.costClass === 'user_allowance',
      `Fallback selected route cost class "${fallback.nextRoute.costClass}" which is not free!`
    );
    assert.strictEqual(fallback.nextRoute.pricing.inputPer1MTokensUSD, 0.0);
  });

  it('halts with error if all free routes are exhausted instead of silently upgrading to paid', async () => {
    db.seed();
    const routes = await db.getRoutes();

    // Disable all verified_free routes to simulate total free capacity exhaustion
    for (const r of routes) {
      if (r.costClass === 'verified_free' || r.costClass === 'user_allowance') {
        await db.updateRouteStatus(r.id, 'disabled');
      }
    }

    await assert.rejects(
      async () => {
        await resolveRouteForTask('user_default', 'Solve this math problem', [], 'free_only');
      },
      (err: Error) => {
        assert.ok(err.message.includes('No eligible routes found'));
        return true;
      }
    );

    // Re-seed DB to clean up
    db.seed();
  });
});
