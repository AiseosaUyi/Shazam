import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { generateText, simulateReadableStream, streamText } from 'ai';
import { createFallbackModel, isRetryableModelError } from '../src/lib/agent/fallback';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const ok = (t: string) => ({
  stream: simulateReadableStream({ chunks: [{ type: 'text-start', id: '1' }, { type: 'text-delta', id: '1', delta: t }, { type: 'text-end', id: '1' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }] as any[] }),
});
const rateLimited = Object.assign(new Error('Rate limit exceeded for alibaba/qwen3-coder-next. Retry after 60s.'), { statusCode: 429 });

describe('Free-tier fail-over model chain', () => {
  it('switches to the next model when the first is rate limited', async () => {
    const a = new MockLanguageModelV4({ modelId: 'a', doStream: async () => { throw rateLimited; } });
    const b = new MockLanguageModelV4({ modelId: 'b', doStream: ok('from b') as any });
    const switches: string[] = [];
    const model = createFallbackModel([{ model: a as any, label: 'A' }, { model: b as any, label: 'B' }], (f, t) => switches.push(`${f}->${t}`));
    const r = streamText({ model, prompt: 'hi' });
    assert.equal(await r.text, 'from b');
    assert.deepEqual(switches, ['A->B']);
  });

  it('does not mask real errors (e.g. bad request) by switching', async () => {
    const bad = Object.assign(new Error('Invalid tool schema'), { statusCode: 400 });
    const a = new MockLanguageModelV4({ modelId: 'c', doGenerate: async () => { throw bad; } });
    const b = new MockLanguageModelV4({ modelId: 'd' });
    const model = createFallbackModel([{ model: a as any, label: 'C' }, { model: b as any, label: 'D' }]);
    await assert.rejects(generateText({ model, prompt: 'x', maxRetries: 0 }), /Invalid tool schema/);
  });

  it('classifies free-tier errors as retryable', () => {
    assert.ok(isRetryableModelError(rateLimited));
    assert.ok(isRetryableModelError(new Error('Free tier users do not have access to this model')));
    assert.ok(!isRetryableModelError(Object.assign(new Error('bad'), { statusCode: 400 })));
  });
});
