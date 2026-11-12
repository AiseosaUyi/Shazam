import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runToolAgent } from '../src/lib/agent/tool_agent';
import { sanitizeSummary } from '../src/lib/runs/report';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const step = (parts: any[], unified: 'tool-calls' | 'stop'): any => ({ stream: simulateReadableStream({ chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }] }) });
const text = (t: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });

/** Found by a live run on the deployed app: bugs that scripted-model tests did not catch. */
describe('Live findings', () => {
  const disk = () => new Map([['/r/add.js', 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };']]);
  const fakeLocal = (d: Map<string, string>) => ({
    root: '/r', deviceName: 'T',
    call: async (command: string, p: any) => {
      if (command === 'list_files') return 'add.js';
      if (command === 'read_file') return d.has(p.path) ? d.get(p.path)!.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n') : 'Error: missing';
      if (command === 'write_file') { d.set(p.path, p.content); return `Wrote ${p.path}`; }
      if (command === 'edit_file') { d.set(p.path, d.get(p.path)!.replace(p.old_string, p.new_string)); return `Edited ${p.path}.`; }
      return 'exit code: 0\n';
    },
  });

  it('local replace_lines accepts an absolute path, like the other local edit tools', async () => {
    const d = disk();
    const model = new MockLanguageModelV4({ doStream: [step([call('1', 'replace_lines', { path: '/r/add.js', start: 2, end: 2, new_text: '  return a - b;' })], 'tool-calls'), step(text('done'), 'stop')] });
    const obs: string[] = [];
    await runToolAgent({ model, prompt: 'Fix add.js', projectName: 'P', files: [], local: fakeLocal(d), onEvent: (e, x: any) => { if (e === 'react_observation') obs.push(x.observation); } });
    assert.doesNotMatch(obs[0], /Blocked by safety policy/);
    assert.match(obs[0], /Replaced lines 2-2/);
    assert.match(d.get('/r/add.js')!, /a - b/);
  });

  it('local edits are recorded under one root-relative name, whether the model used an absolute or relative path', async () => {
    const d = disk();
    d.set('/r/ARCWORK.md', 'x');
    const model = new MockLanguageModelV4({
      doStream: [
        step([call('1', 'edit_file', { path: '/r/add.js', old_string: 'a + b', new_string: 'a - b' })], 'tool-calls'),
        step([call('2', 'write_file', { path: './ARCWORK.md', content: 'notes' })], 'tool-calls'),
        step([call('3', 'edit_file', { path: 'add.js', old_string: 'a - b', new_string: 'a * b' })], 'tool-calls'),
        step(text('done'), 'stop'),
      ],
    });
    const events: string[] = [];
    const r = await runToolAgent({ model, prompt: 'Fix add.js', projectName: 'P', files: [], local: fakeLocal(d), onEvent: (e, x: any) => { if (e === 'file_changed') events.push(x.path); } });
    assert.deepEqual(r.edits.map((e) => e.path), ['add.js', 'ARCWORK.md', 'add.js']);
    assert.deepEqual(r.filesModified.sort(), ['ARCWORK.md', 'add.js']);
    assert.deepEqual(events, ['add.js', 'ARCWORK.md', 'add.js']);
  });

  it('the summary cleaner leaves a file alone when the line is not claiming a change (a function called "add")', () => {
    const rec = { edits: [{ path: 'add.js', action: 'edit' as const, added: 1, removed: 1 }], commands: [] };
    const line = '**Problem:** `add.test.js` expects add(2, 2) to return 5.';
    assert.equal(sanitizeSummary(line, rec), line);
    assert.equal(sanitizeSummary('I changed add.js and ghost.ts.', rec), 'I changed add.js and [unverified file].');
  });
});
