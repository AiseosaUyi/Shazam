import { describe, it } from 'node:test';
import assert from 'node:assert';
import { db } from '@/lib/db';
import { TaskOrchestrator } from '@/lib/task/orchestrator';

describe('Integration: End-to-End Routing, Streaming & Resilient Fallback', () => {
  it('successfully executes a task with explainable route rationale', async () => {
    db.seed();
    const task = await TaskOrchestrator.executeTask({
      userId: 'user_default',
      prompt: 'Summarize the architecture of a multi-model router',
      costPolicy: 'free_only',
    });

    assert.strictEqual(task.status, 'succeeded');
    assert.ok(task.responseOutput && task.responseOutput.length > 20);
    assert.strictEqual(task.attempts.length, 1);
    assert.strictEqual(task.attempts[0].state, 'succeeded');
    assert.ok(task.decisionTrace);
    assert.ok(task.decisionTrace.selectionRationale.includes('Selected'));
  });

  it('triggers resilient fallback when provider returns 429 rate limit', async () => {
    db.seed();
    // Simulate rate limit failure on the route
    const prompt = 'Please solve this math problem [SIMULATE_429]';

    // Under balanced or lowest cost policy with simulation route
    const task = await TaskOrchestrator.executeTask({
      userId: 'user_default',
      prompt,
      costPolicy: 'free_only',
    });

    assert.strictEqual(task.status, 'succeeded');
    // First attempt failed with 429, second attempt succeeded on fallback!
    assert.strictEqual(task.attempts.length, 2);
    assert.strictEqual(task.attempts[0].state, 'failed');
    assert.strictEqual(task.attempts[0].error?.type, 'rate_limited');
    assert.strictEqual(task.attempts[1].state, 'succeeded');
  });

  it('records usage event in the ledger with token counts and cost', async () => {
    db.seed();
    const task = await TaskOrchestrator.executeTask({
      userId: 'user_default',
      prompt: 'Generate a short poem about intelligent routing',
      costPolicy: 'free_only',
    });

    const summary = await db.getUsageSummaryForUser('user_default');
    assert.ok(summary.totalRequests > 0);
    assert.ok(summary.totalTokens > 0);
    assert.strictEqual(summary.events[0].taskId, task.id);
  });
});
