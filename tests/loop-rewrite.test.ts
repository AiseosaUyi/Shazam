import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runToolAgent } from '../src/lib/agent/tool_agent';
import { failureSignature, StallGuard } from '../src/lib/agent/stall-guard';
import { lineSimilarity, rewriteVerdict } from '../src/lib/agent/edit-hints';
import { modelStats, suggestModel } from '../src/lib/runs/estimate';
import { stalledNote } from '../src/lib/runs/background';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const step = (parts: any[], unified: 'tool-calls' | 'stop'): any => ({ stream: simulateReadableStream({ chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }] }) });
const text = (t: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });

const FAIL = (ms: number) => ({ exitCode: 1, output: `not ok 1 - clamp\n  AssertionError: expected 3 but got 2 (${ms}ms)\n  at /tmp/x/src/a.test.js:7:12` });

describe('Looping on the same test failure', () => {
  it('the signature ignores numbers, timings and paths, but not the failure itself', () => {
    assert.equal(failureSignature(FAIL(12).output), failureSignature(FAIL(340).output.replace('/tmp/x', '/tmp/y').replace(':7:12', ':9:3')));
    assert.notEqual(failureSignature(FAIL(1).output), failureSignature('not ok 1 - slug\n  TypeError: x is not a function'));
  });

  it('counts consecutive identical failures; a pass or a different failure resets it', () => {
    const g = new StallGuard();
    g.onCommand(`exit code: 1\n${FAIL(1).output}`);
    g.onCommand(`exit code: 1\n${FAIL(2).output}`);
    assert.equal(g.repeatFailures, 2);
    g.onCommand('exit code: 1\nTypeError: other thing');
    assert.equal(g.repeatFailures, 1);
    g.onCommand('exit code: 0\nok');
    assert.equal(g.repeatFailures, 0);
  });

  it('warns on the 3rd identical failure and stops the run as stalled (repeat_failure) on the 6th', async () => {
    let n = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        n++;
        if (n % 2) return step([call(`c${n}`, 'run_command', { command: 'npm test' })], 'tool-calls');
        return step([call(`e${n}`, 'edit_file', { path: 'src/a.js', old_string: `v${n - 2}`, new_string: `v${n}` })], 'tool-calls');
      },
    });
    const obs: string[] = [];
    let ms = 0;
    const r = await runToolAgent({
      model, prompt: 'Fix the clamp bug in src/a.js', projectName: 'P', maxSteps: 100,
      files: [{ path: 'src/a.js', content: 'const v0 = 1;\n' }],
      runCommand: async () => FAIL(++ms),
      onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); },
    });
    assert.equal(r.stalled, true);
    assert.equal(r.stallReason, 'repeat_failure');
    const cmd = obs.filter((o) => /^\$ npm test/.test(o));
    assert.doesNotMatch(cmd[1], /SAME FAILURE/);
    assert.match(cmd[2], /SAME FAILURE 3 TIMES IN A ROW/);
    assert.match(cmd[2], /Do NOT change a test's expectations/);
    assert.equal(cmd.length, 6);
  });

  it('warns when the model edits a test file while the failure repeats', async () => {
    let n = 0;
    const seq = [
      call('1', 'run_command', { command: 'npm test' }), call('2', 'run_command', { command: 'npm test' }),
      call('3', 'edit_file', { path: 'tests/a.test.js', old_string: 'toBe(3)', new_string: 'toBe(2)' }),
    ];
    const model = new MockLanguageModelV4({ doStream: async () => (n < 3 ? step([seq[n++]], 'tool-calls') : step(text('done'), 'stop')) });
    const obs: string[] = [];
    await runToolAgent({
      model, prompt: 'Fix the clamp bug', projectName: 'P',
      files: [{ path: 'tests/a.test.js', content: 'expect(x).toBe(3)\n' }],
      runCommand: async () => FAIL(5),
      onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); },
    });
    assert.match(obs[2], /you edited a test file while the same test failure keeps repeating/);
  });

  it('the stalled note for a repeat failure says so', () => {
    assert.match(stalledNote(0, ['a.js'], 'repeat_failure'), /same command failed the same way 6 times/);
    assert.match(stalledNote(50, ['a.js'], 'no_edit'), /50 steps with no edit/);
  });
});

const big = Array.from({ length: 60 }, (_, i) => `export const line${i} = ${i};`).join('\n');

describe('Whole-file rewrites for a small change', () => {
  it('similarity and verdicts', () => {
    assert.equal(lineSimilarity('a\nb\nc', 'a\nb\nc'), 1);
    const small = big.replace('line5 = 5', 'line5 = 500');
    assert.equal(rewriteVerdict(big, small).hold, true);
    assert.equal(rewriteVerdict(big, big).hold, false);
    assert.equal(rewriteVerdict(big, big.split('\n').slice(0, 20).join('\n')).hold, true, 'truncated');
    assert.equal(rewriteVerdict(big, Array.from({ length: 60 }, (_, i) => `function f${i}() { return ${i * 7}; }`).join('\n')).hold, false, 'a real rewrite');
    assert.equal(rewriteVerdict('a\nb', 'a\nc').hold, false, 'small files are free to rewrite');
  });

  it('holds a near-identical write_file, then applies it when the model repeats the same content', async () => {
    const small = big.replace('line5 = 5', 'line5 = 500');
    const files = [{ path: 'big.ts', content: big }];
    const model = new MockLanguageModelV4({
      doStream: [
        step([call('1', 'write_file', { path: 'big.ts', content: small })], 'tool-calls'),
        step([call('2', 'write_file', { path: 'big.ts', content: small })], 'tool-calls'),
        step(text('done'), 'stop'),
      ],
    });
    const obs: string[] = [];
    const r = await runToolAgent({ model, prompt: 'Change line5 in big.ts', projectName: 'P', files, onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); } });
    assert.match(obs[0], /^Error: rewrite held, nothing was written\. Only about \d+ of 60 lines differ/);
    assert.match(obs[0], /edit_file or replace_lines/);
    assert.match(obs[1], /^Overwrote big\.ts/);
    assert.equal(files[0].content, small);
    assert.equal(r.edits.length, 1, 'the held attempt is not recorded as an edit');
  });

  it('a different follow-up write is held again, not waved through', async () => {
    const a = big.replace('line5 = 5', 'line5 = 500');
    const b = big.replace('line6 = 6', 'line6 = 600');
    const files = [{ path: 'big.ts', content: big }];
    const model = new MockLanguageModelV4({
      doStream: [step([call('1', 'write_file', { path: 'big.ts', content: a })], 'tool-calls'), step([call('2', 'write_file', { path: 'big.ts', content: b })], 'tool-calls'), step(text('done'), 'stop')],
    });
    const r = await runToolAgent({ model, prompt: 'Change big.ts', projectName: 'P', files });
    assert.equal(files[0].content, big);
    assert.equal(r.edits.length, 0);
  });

  it('works through the local bridge too', async () => {
    const small = big.replace('line5 = 5', 'line5 = 500');
    const disk = new Map([['/r/big.ts', big]]);
    const local = {
      root: '/r', deviceName: 'T',
      call: async (command: string, p: any) => {
        if (command === 'list_files') return 'big.ts';
        if (command === 'read_file') return disk.get(p.path)!.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n');
        if (command === 'write_file') { disk.set(p.path, p.content); return `Wrote ${p.path}`; }
        return 'exit code: 0\n';
      },
    };
    const model = new MockLanguageModelV4({
      doStream: [step([call('1', 'write_file', { path: 'big.ts', content: small })], 'tool-calls'), step([call('2', 'write_file', { path: 'big.ts', content: small })], 'tool-calls'), step(text('done'), 'stop')],
    });
    const obs: string[] = [];
    await runToolAgent({ model, prompt: 'Change big.ts', projectName: 'P', files: [], local, onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); } });
    assert.match(obs[0], /rewrite held/);
    assert.equal(disk.get('/r/big.ts'), small);
  });
});

describe('Model suggestion after a stall (P2-C)', () => {
  const run = (model: string, status: string, steps = 20, minutes = 10) => ({
    model, status, agent: 'code',
    events: Array.from({ length: steps }, () => ({ type: 'step', at: '' })),
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: new Date(Date.parse('2026-11-12T10:00:00.000Z') + minutes * 60_000).toISOString(),
  });

  it('suggests a model with clearly better edit success, and only with enough evidence', () => {
    const past = [
      ...Array.from({ length: 4 }, () => run('qwen local · local', 'stalled')),
      ...Array.from({ length: 4 }, () => run('gemini-flash', 'done')),
    ];
    const s = suggestModel(modelStats(past), 'qwen local · local')!;
    assert.match(s, /retry on model "gemini-flash": it made edits in 100% of 4 recent runs/);
    assert.match(s, /against 0% for qwen local/);
    assert.match(s, /nothing switched by itself/);
    assert.equal(suggestModel(modelStats(past.slice(0, 5)), 'qwen local · local'), null, 'only 1 run of gemini is not evidence');
  });

  it('stays quiet when the current model is already the best, or there is no data', () => {
    const past = Array.from({ length: 4 }, () => run('gemini-flash', 'done'));
    assert.equal(suggestModel(modelStats(past), 'gemini-flash'), null);
    assert.equal(suggestModel([], 'x'), null);
  });

  it('suggests a faster model when success is equal', () => {
    const past = [...Array.from({ length: 3 }, () => run('slow', 'done', 20, 20)), ...Array.from({ length: 3 }, () => run('fast', 'done', 20, 4))];
    assert.match(suggestModel(modelStats(past), 'slow')!, /"fast"/);
  });
});
