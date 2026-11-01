import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cooldownMs } from '../src/lib/agent/fallback';
import { orderAgentChain } from '../src/lib/agent/resolve';

const MIN = 60_000;

describe('agent model order', () => {
  it('moves Groq to the end, after other keys and the free platform models', () => {
    const chain = [{ provider: 'groq' }, { provider: 'google' }, { provider: 'cerebras' }, { provider: 'local' }, { provider: 'gateway' }];
    assert.deepEqual(orderAgentChain(chain).map((c) => c.provider), ['google', 'cerebras', 'local', 'gateway', 'groq']);
  });

  it('leaves a chain without Groq unchanged', () => {
    const chain = [{ provider: 'openai' }, { provider: 'google' }, { provider: 'gateway' }];
    assert.equal(orderAgentChain(chain), chain);
  });
});

describe('rate-limit cooldown', () => {
  it('uses the provider hint when longer than the backoff', () => {
    assert.equal(cooldownMs({ message: 'Rate limit reached. Please try again in 2m30s.' }), 150_000);
    assert.equal(cooldownMs({ message: 'Too many requests, retry after 90 s' }), 90_000);
  });

  it('backs off further on each repeat, capped at 15 minutes', () => {
    const err = { message: 'rate limit, try again in 7.5s' };
    assert.equal(cooldownMs(err, 1), MIN);
    assert.equal(cooldownMs(err, 2), 2 * MIN);
    assert.equal(cooldownMs(err, 3), 4 * MIN);
    assert.equal(cooldownMs(err, 10), 15 * MIN);
  });

  it('rests a model for 30 minutes when the request cannot fit its budget or the day is spent', () => {
    assert.equal(cooldownMs({ statusCode: 413, message: 'Request too large for model on tokens per minute (TPM): Limit 6000, Requested 9000' }), 30 * MIN);
    assert.equal(cooldownMs({ message: 'Rate limit reached on tokens per day (TPD)' }), 30 * MIN);
  });
});
