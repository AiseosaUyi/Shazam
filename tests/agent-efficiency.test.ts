import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { generateText, simulateReadableStream, streamText, tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { compactMessages } from '@/lib/agent/compact';
import { streamAgent, stallReason } from '@/lib/agent/stream';
import { createFallbackModel } from '@/lib/agent/fallback';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const textStream = (t: string) => ({
  stream: simulateReadableStream({ chunks: [{ type: 'text-start', id: '1' }, { type: 'text-delta', id: '1', delta: t }, { type: 'text-end', id: '1' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }] as any[] }),
});

/** A long run: n file reads with big outputs. */
function longRun(n: number, outputSize = 20_000): ModelMessage[] {
  const msgs: ModelMessage[] = [{ role: 'user', content: 'refactor everything' }];
  for (let i = 0; i < n; i++) {
    msgs.push({ role: 'assistant', content: [{ type: 'reasoning', text: 'thinking '.repeat(200) }, { type: 'tool-call', toolCallId: `c${i}`, toolName: 'write_file', input: { path: `f${i}.ts`, content: 'x'.repeat(5000) } }] } as any);
    msgs.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${i}`, toolName: 'write_file', output: { type: 'text', value: 'y'.repeat(outputSize) } }] } as any);
  }
  return msgs;
}

describe('Context compaction', () => {
  it('leaves short conversations untouched', () => {
    const msgs = longRun(2, 100);
    assert.equal(compactMessages(msgs), msgs);
  });

  it('shortens old tool output, big inputs and old reasoning, keeping recent steps intact', () => {
    const msgs = longRun(20);
    const before = JSON.stringify(msgs).length;
    const out = compactMessages(msgs, { keepRecentResults: 6 });
    const after = JSON.stringify(out).length;
    assert.ok(after < before / 3, `expected a big cut: ${before} → ${after}`);
    const last = out[out.length - 1] as any;
    assert.equal(last.content[0].output.value.length, 20_000, 'newest tool result kept in full');
    const old = out[2] as any;
    assert.match(old.content[0].output.value, /older output shortened/);
    const oldCall = (out[1] as any).content;
    assert.equal(oldCall.some((p: any) => p.type === 'reasoning'), false, 'old reasoning dropped');
    assert.match(oldCall[0].input.content, /shortened/);
    assert.equal(out[0], msgs[0], 'the task prompt is never touched');
    // Tool calls and results still pair up.
    assert.deepEqual(out.filter((m) => m.role === 'tool').length, 20);
  });

  it('is idempotent', () => {
    const once = compactMessages(longRun(20));
    assert.equal(JSON.stringify(compactMessages(once)), JSON.stringify(once));
  });
});

describe('Stall recovery', () => {
  it('spots tool calls written as text, empty replies and cut-off answers', () => {
    assert.equal(stallReason('<tool_call>{"name":"read_file"}</tool_call>'), 'text-tool-call');
    assert.equal(stallReason('{"name": "read_file", "arguments": {"path": "a"}}'), 'text-tool-call');
    assert.equal(stallReason('   '), 'empty');
    assert.equal(stallReason('half a sentence', 'length'), 'cut-off');
    assert.equal(stallReason('All 7 tests pass.'), null);
  });

  it('nudges a model that wrote a tool call as text, and the task completes', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      modelId: 'qwen',
      doStream: async () => {
        calls++;
        return textStream(calls === 1 ? '<tool_call>{"name":"work","arguments":{}}</tool_call>' : 'Done: work finished.') as any;
      },
    });
    const events: string[] = [];
    const out = await streamAgent({
      model: model as any,
      instructions: 'x',
      messages: [{ role: 'user', content: 'go' }],
      tools: { work: tool({ description: 'w', inputSchema: z.object({}), execute: async () => 'ok' }) },
      maxSteps: 10,
      onEvent: (e, d: any) => { if (e === 'react_observation') events.push(d.observation); },
    });
    assert.equal(calls, 2);
    assert.equal(out.text, 'Done: work finished.');
    assert.ok(events.some((e) => /Nudged/.test(e)));
  });

  it('stops nudging after two tries', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({ modelId: 'empty', doStream: async () => { calls++; return textStream('') as any; } });
    await streamAgent({ model: model as any, instructions: 'x', messages: [{ role: 'user', content: 'go' }], tools: {}, maxSteps: 10 });
    assert.equal(calls, 3);
  });
});

describe('Fallback on provider-specific errors', () => {
  it('tries the next model when one provider rejects the request (4xx)', async () => {
    const rejects = new MockLanguageModelV4({ modelId: 'groq', doStream: async () => { throw Object.assign(new Error('tool schema not supported'), { statusCode: 400 }); } });
    const works = new MockLanguageModelV4({ modelId: 'gemini', doStream: async () => textStream('from gemini') as any });
    const switches: string[] = [];
    const model = createFallbackModel([{ model: rejects as any, label: 'Groq' }, { model: works as any, label: 'Gemini' }], (f, t) => switches.push(`${f}->${t}`));
    assert.equal(await streamText({ model, prompt: 'hi' }).text, 'from gemini');
    assert.deepEqual(switches, ['Groq->Gemini']);
  });

  it('reports the first real error when every model rejects the request', async () => {
    const a = new MockLanguageModelV4({ modelId: 'a', doGenerate: async () => { throw Object.assign(new Error('prompt too long for a'), { statusCode: 400 }); } });
    const b = new MockLanguageModelV4({ modelId: 'b', doGenerate: async () => { throw Object.assign(new Error('bad request b'), { statusCode: 422 }); } });
    const model = createFallbackModel([{ model: a as any, label: 'A' }, { model: b as any, label: 'B' }]);
    await assert.rejects(generateText({ model, prompt: 'hi', maxRetries: 0 }), /prompt too long for a/);
  });
});

describe('Post-edit syntax checks', () => {
  it('checks JS and JSON files, and skips the rest', async () => {
    const { syntaxCheckCommand } = await import('@/lib/agent/tool_agent');
    assert.equal(syntaxCheckCommand('/r/desktop/bridge-core.js'), 'node --check "/r/desktop/bridge-core.js"');
    assert.match(syntaxCheckCommand('/r/a.mjs') || '', /^node --check/);
    assert.match(syntaxCheckCommand('/r/package.json') || '', /JSON\.parse/);
    assert.match(syntaxCheckCommand('/r/page.tsx') || '', /^node -e '.*transpileModule.*' "\/r\/page\.tsx"$/);
    assert.match(syntaxCheckCommand('/r/a.ts') || '', /transpileModule/);
    assert.match(syntaxCheckCommand('/r/a.jsx') || '', /transpileModule/);
    assert.equal(syntaxCheckCommand('/r/readme.md'), null);
    assert.equal(syntaxCheckCommand('/r/a; rm -rf ~.js'), 'node --check "/r/a; rm -rf ~.js"', 'path is quoted');
  });
});

describe('Lessons from the failed bridge sprint', () => {
  it('reads local files in ranges with a hint for the rest', async () => {
    const { sliceNumbered } = await import('@/lib/agent/tool_agent');
    const numbered = Array.from({ length: 500 }, (_, i) => `${i + 1}\tline ${i + 1}`).join('\n');
    const first = sliceNumbered('a.js', numbered, 1, 200);
    assert.match(first, /^a\.js \(500 lines\)/);
    assert.match(first, /300 more lines \(read again with offset=201\)/);
    assert.equal(first.split('\n').length, 202);
    assert.match(sliceNumbered('a.js', numbered, 401, 200), /500\tline 500$/);
    assert.equal(sliceNumbered('a.js', 'Error: no such file', 1, 200), 'Error: no such file');
  });

  it('keeps recent tool output only up to a size budget', () => {
    // 6 recent reads of ~16K chars each would be ~96K chars: only the newest fit in 40K.
    const out = compactMessages(longRun(8, 16_000), { keepRecentResults: 6, keepRecentChars: 40_000 });
    const tools = out.filter((m) => m.role === 'tool') as any[];
    const full = tools.filter((m) => m.content[0].output.value.length === 16_000).length;
    assert.ok(full >= 1 && full <= 2, `expected 1-2 full results, got ${full}`);
    assert.ok(JSON.stringify(out).length < 60_000);
  });

  it('treats an exhausted model chain as "rest and retry", with growing rests', async () => {
    const { allModelsBusy, busyRestMs } = await import('@/lib/runs/background');
    assert.equal(allModelsBusy(new Error('Request too large for model on input tokens per minute (ITPM): Limit 7000')), true);
    assert.equal(allModelsBusy(Object.assign(new Error('Rate limit exceeded: free-models-per-day'), { statusCode: 429 })), true);
    assert.equal(allModelsBusy(new Error('local model timed out (qwen3.6)')), true);
    assert.equal(allModelsBusy(Object.assign(new Error('Invalid tool schema'), { statusCode: 400 })), false);
    assert.deepEqual([0, 1, 2, 3, 6].map((s) => busyRestMs(s) / 60_000), [2, 4, 8, 16, 20]);
  });
});
