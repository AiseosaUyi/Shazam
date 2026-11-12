import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runToolAgent } from '../src/lib/agent/tool_agent';
import { StallGuard } from '../src/lib/agent/stall-guard';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const step = (parts: any[], unified: 'tool-calls' | 'stop'): any => ({ stream: simulateReadableStream({ chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }] }) });
const text = (t: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });

const files = () => [
  { path: 'a.ts', content: 'export const a = 1;\n' },
  { path: 'b.ts', content: 'export const b = 2;\n' },
  { path: 'c.ts', content: 'export const c = 3;\n' },
];

/** A model that only ever reads files, round and round. */
function readOnlyModel(total: number) {
  let n = 0;
  const paths = ['a.ts', 'b.ts', 'c.ts'];
  return new MockLanguageModelV4({
    doStream: async () => {
      n++;
      if (n > total) return step(text('I have read enough.'), 'stop');
      return step([call(`r${n}`, 'read_file', { path: paths[n % 3], offset: n })], 'tool-calls');
    },
  });
}

describe('Stall guard (P0-B)', () => {
  it('a model that only reads is stopped as stalled at 50 steps with no edit', async () => {
    const model = readOnlyModel(500);
    const obs: string[] = [];
    const r = await runToolAgent({ model, prompt: 'Fix the bug in a.ts', projectName: 'P', files: files(), maxSteps: 200, onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); } });
    assert.equal(r.stalled, true);
    assert.equal(r.edits.length, 0);
    assert.ok(r.steps <= 52, `stopped near 50 steps, got ${r.steps}`);
    assert.equal(r.stepsSinceLastEdit, 50);
    assert.deepEqual(r.filesRead.sort(), ['a.ts', 'b.ts', 'c.ts']);
  });

  it('injects a firm "make your first edit now" instruction after 25 steps, listing files read', async () => {
    const model = readOnlyModel(30);
    const r = await runToolAgent({ model, prompt: 'Fix the bug in a.ts', projectName: 'P', files: files(), maxSteps: 100 });
    assert.equal(r.stalled, false);
    const sent = JSON.stringify(model.doStreamCalls[27].prompt);
    assert.match(sent, /STOP EXPLORING/);
    assert.match(sent, /Files already read: .*a\.ts/);
    assert.doesNotMatch(JSON.stringify(model.doStreamCalls[10].prompt), /STOP EXPLORING/);
  });

  it('a read of an unchanged range returns a short note instead of the file', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        step([call('1', 'read_file', { path: 'a.ts' })], 'tool-calls'),
        step([call('2', 'read_file', { path: 'a.ts' })], 'tool-calls'),
        step(text('done'), 'stop'),
      ],
    });
    const obs: string[] = [];
    await runToolAgent({ model, prompt: 'Fix a.ts', projectName: 'P', files: files(), onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); } });
    assert.match(obs[0], /export const a = 1/);
    assert.match(obs[1], /Already read lines 1-\d+ of a\.ts at step 1; the file is unchanged/);
    assert.doesNotMatch(obs[1], /export const a/);
  });

  it('returns the content again once the file has changed', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        step([call('1', 'read_file', { path: 'a.ts' })], 'tool-calls'),
        step([call('2', 'edit_file', { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' })], 'tool-calls'),
        step([call('3', 'read_file', { path: 'a.ts' })], 'tool-calls'),
        step(text('done'), 'stop'),
      ],
    });
    const obs: string[] = [];
    const r = await runToolAgent({ model, prompt: 'Fix a.ts', projectName: 'P', files: files(), onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); } });
    assert.match(obs[2], /export const a = 2/);
    assert.equal(r.edits.length, 1);
    assert.equal(r.stepsSinceLastEdit, 1);
  });

  it('an edit resets the counter, so a working run is never stalled', async () => {
    let n = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        n++;
        if (n > 120) return step(text('done'), 'stop');
        if (n % 10 === 0) return step([call(`e${n}`, 'write_file', { path: `n${n}.ts`, content: 'x\n' })], 'tool-calls');
        return step([call(`r${n}`, 'list_files', {})], 'tool-calls');
      },
    });
    const r = await runToolAgent({ model, prompt: 'Add helpers', projectName: 'P', files: files(), maxSteps: 200 });
    assert.equal(r.stalled, false);
    assert.ok(r.edits.length >= 10);
  });

  it('is off in plan mode and for prompts that do not ask for changes', async () => {
    const r1 = await runToolAgent({ model: readOnlyModel(70), prompt: 'Explain how a.ts works', projectName: 'P', files: files(), maxSteps: 200 });
    assert.equal(r1.stalled, false);
    const r2 = await runToolAgent({ model: readOnlyModel(70), prompt: 'Fix the bug', projectName: 'P', files: files(), maxSteps: 200, planMode: true });
    assert.equal(r2.stalled, false);
  });

  it('counts across resumed segments', () => {
    const g = new StallGuard({ sinceEdit: 48 });
    g.begin();
    assert.equal(g.stalled, false);
    g.begin();
    assert.equal(g.stalled, true);
  });
});
