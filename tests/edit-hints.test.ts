import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runToolAgent } from '../src/lib/agent/tool_agent';
import { EditFailureTracker, failureAdvice, nearestLines, replaceLineRange } from '../src/lib/agent/edit-hints';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const step = (parts: any[], unified: 'tool-calls' | 'stop'): any => ({ stream: simulateReadableStream({ chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }] }) });
const text = (t: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });

const SRC = 'import x from "y";\n\nexport function clamp(value: number, min: number, max: number) {\n  return Math.min(max, Math.max(min, value));\n}\n\nexport const done = true;\n';

describe('Smarter edit_file failures (P1-C)', () => {
  it('nearestLines finds the right line, with numbers, when old_string is slightly wrong', () => {
    const out = nearestLines(SRC, 'export function clamp(val: number, lo: number, hi: number) {\n  return 1;');
    assert.match(out, /^line 3: export function clamp/);
    assert.match(out, /3\texport function clamp\(value: number/);
    assert.match(out, /4\t  return Math\.min/);
  });

  it('says so when nothing is similar, and never exceeds 1500 chars', () => {
    assert.match(nearestLines(SRC, 'zzz qqq www'), /^No similar lines found/);
    const big = Array.from({ length: 400 }, (_, i) => `const value${i} = compute(value, min, max, ${'x'.repeat(100)});`).join('\n');
    assert.ok(nearestLines(big, 'const value = compute(value, min, max);').length <= 1500);
  });

  it('counts failures per path; advice starts at the second failure', () => {
    const t = new EditFailureTracker();
    assert.equal(t.record('a.ts'), 1);
    assert.equal(t.record('a.ts'), 2);
    assert.equal(t.record('b.ts'), 1);
    assert.equal(failureAdvice('a.ts', 1, true), '');
    assert.match(failureAdvice('a.ts', 2, true), /replace_lines/);
    assert.match(failureAdvice('a.ts', 2, false), /write_file/);
    t.reset('a.ts');
    assert.equal(t.record('a.ts'), 1);
  });

  it('through the agent: a bad edit shows nearest lines, a second says to stop retrying', async () => {
    const bad = (id: string) => call(id, 'edit_file', { path: 'src/c.ts', old_string: 'export function clamp(val: number) {', new_string: 'x' });
    const model = new MockLanguageModelV4({ doStream: [step([bad('1')], 'tool-calls'), step([bad('2')], 'tool-calls'), step(text('gave up'), 'stop')] });
    const obs: string[] = [];
    await runToolAgent({ model, prompt: 'Fix clamp', projectName: 'P', files: [{ path: 'src/c.ts', content: SRC }], onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); } });
    assert.match(obs[0], /Nearest matching lines:\nline 3: export function clamp/);
    assert.doesNotMatch(obs[0], /Stop retrying/);
    assert.match(obs[1], /Stop retrying edit_file with guessed text/);
    assert.match(obs[1], /replace_lines/);
  });

  it('replace_lines swaps a line range and records the edit; bad ranges are refused', async () => {
    const files = [{ path: 'f.ts', content: 'one\ntwo\nthree\nfour' }];
    const model = new MockLanguageModelV4({
      doStream: [
        step([call('1', 'replace_lines', { path: 'f.ts', start: 2, end: 3, new_text: 'TWO\nTHREE\nTHREE-B' })], 'tool-calls'),
        step([call('2', 'replace_lines', { path: 'f.ts', start: 3, end: 99, new_text: 'x' })], 'tool-calls'),
        step(text('done'), 'stop'),
      ],
    });
    const obs: string[] = [];
    const r = await runToolAgent({ model, prompt: 'Change f.ts', projectName: 'P', files, onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); } });
    assert.equal(files[0].content, 'one\nTWO\nTHREE\nTHREE-B\nfour');
    assert.match(obs[0], /Replaced lines 2-3 of f\.ts with 3 lines/);
    assert.match(obs[1], /Error: line range out of bounds \(file has 5 lines\)/);
    assert.deepEqual(r.edits, [{ path: 'f.ts', action: 'edit', added: 3, removed: 2 }]);
  });

  it('replaceLineRange handles deletion and bounds', () => {
    assert.deepEqual(replaceLineRange('a\nb\nc', 2, 2, ''), { ok: true, content: 'a\nc', added: 0, removed: 1 });
    assert.equal(replaceLineRange('a\nb', 2, 1, 'x').ok, false);
  });
});

describe('Auto syntax check for TS/TSX (P1-B)', () => {
  it('catches a syntax error in a .ts and .tsx file with line numbers, and passes valid files', async () => {
    const { syntaxCheckCommand } = await import('../src/lib/agent/tool_agent');
    const { execSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'syn-'));
    const run = (file: string, body: string) => {
      const p = join(dir, file);
      writeFileSync(p, body);
      try {
        execSync(syntaxCheckCommand(p)!, { cwd: process.cwd(), stdio: 'pipe' });
        return { code: 0, err: '' };
      } catch (e: any) {
        return { code: e.status, err: String(e.stderr) };
      }
    };
    assert.deepEqual(run('ok.ts', 'export const a: number = 1;\n'), { code: 0, err: '' });
    assert.deepEqual(run('ok.tsx', 'export const A = () => <div className="x">hi</div>;\n'), { code: 0, err: '' });
    const bad = run('bad.ts', 'export function f( {\n  return 1;\n}\n');
    assert.equal(bad.code, 1);
    assert.match(bad.err, /bad\.ts:\d+:\d+ /);
    const badTsx = run('bad.tsx', 'export const A = () => <div>hi</span>;\n');
    assert.equal(badTsx.code, 1);
  });

  it('runs after an edit through the local tool and returns the error in the same result', async () => {
    const files = new Map<string, string>([['/r/a.ts', 'export const a = 1;\n']]);
    const local = {
      root: '/r', deviceName: 'T',
      call: async (command: string, payload: any) => {
        if (command === 'list_files') return 'a.ts';
        if (command === 'edit_file') { files.set(payload.path, payload.new_string); return `Edited ${payload.path}.`; }
        if (command === 'exec') return 'exit code: 1\n/r/a.ts:1:20 \'}\' expected.';
        return 'Error: unsupported';
      },
    };
    const model = new MockLanguageModelV4({ doStream: [step([call('1', 'edit_file', { path: 'a.ts', old_string: 'export const a = 1;', new_string: 'export const a = {' })], 'tool-calls'), step(text('done'), 'stop')] });
    const obs: string[] = [];
    await runToolAgent({ model, prompt: 'Change a', projectName: 'P', files: [], local, onEvent: (e, d: any) => { if (e === 'react_observation') obs.push(d.observation); } });
    assert.match(obs[0], /Edited \/r\/a\.ts\./);
    assert.match(obs[0], /SYNTAX ERROR after this edit/);
    assert.match(obs[0], /a\.ts:1:20/);
  });
});
