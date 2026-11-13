import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream, type ModelMessage } from 'ai';
import { runToolAgent } from '../src/lib/agent/tool_agent';
import { splitBrief, filesIn } from '../src/lib/agent/multi-fix';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const step = (parts: any[], unified: 'tool-calls' | 'stop'): any => ({ stream: simulateReadableStream({ chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }] }) });
const text = (t: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });

const BRIEF = `Repo at /r. Fix these bugs.

FIX 1: In src/a.ts the clamp helper is off by one. Change it.
FIX 2: In src/b.ts parse() drops the last row.
FIX 3: In src/c.ts and tests/c.test.ts the date format is wrong.

ACCEPTANCE: run npx tsc --noEmit. Do not touch other files.`;

describe('Multi-fix briefs (P1-D)', () => {
  it('splits 3+ labelled fixes, keeping the preamble and acceptance text', () => {
    const plan = splitBrief(BRIEF)!;
    assert.equal(plan.kind, 'labelled');
    assert.equal(plan.items.length, 3);
    assert.deepEqual(plan.items.map((i) => i.label), ['FIX 1', 'FIX 2', 'FIX 3']);
    assert.match(plan.preamble, /Repo at \/r/);
    assert.match(plan.postamble, /^ACCEPTANCE: run npx tsc/);
    assert.deepEqual(plan.items[2].files, ['src/c.ts', 'tests/c.test.ts']);
    assert.doesNotMatch(plan.items[2].body, /ACCEPTANCE/);
  });

  it('also splits "1) 2) 3)" lists, and ignores fewer than 3 or out-of-order labels', () => {
    assert.equal(splitBrief('Do:\n1) edit a.ts\n2) edit b.ts\n3) edit c.ts')?.items.length, 3);
    assert.equal(splitBrief('Do:\n1) edit a.ts\n2) edit b.ts'), null);
    assert.equal(splitBrief('Do:\n3) a\n5) b\n7) c'), null);
    assert.equal(splitBrief('Fix the bug in src/a.ts'), null);
  });

  it('does not split a numbered spec or rules list (the fix-by-fix split must not hijack one coherent task)', () => {
    const spec = 'Implement the scheduler in scheduler.js.\n\nRules:\n1. A task starts after its deps finish.\n2. At most N tasks run at once.\n3. Failed tasks are retried.\n4. Cycles are rejected.\n\nAPI:\n1. add(id, fn)\n2. run()\n3. results';
    assert.equal(splitBrief(spec), null);
    const sameFile = 'Implement in diff.js:\n1) diff(a, b) returns edits\n2) patch(a, ops) applies them\n3) unifiedDiff formats output (all in diff.js)';
    assert.equal(splitBrief(sameFile), null, 'items that share one file are parts of one job');
    assert.equal(splitBrief('Do:\nSTEP 1: read a.ts\nSTEP 2: edit b.ts\nSTEP 3: run tests in c.ts'), null, 'steps are sequential, not independent');
  });

  it('a bare numbered list still splits when each item names its own file', () => {
    const plan = splitBrief('Fix these:\n1. a.ts: off by one\n2. b.ts: wrong sign\n3. c.ts: missing await')!;
    assert.equal(plan.items.length, 3);
    assert.equal(splitBrief('Do:\n1) edit a.ts\n2) edit a.ts again\n3) edit b.ts'), null, 'item 2 has no file of its own');
  });

  it('word-labelled parts always split, even without files', () => {
    assert.equal(splitBrief('FIX 1: handle null\nFIX 2: handle empty\nFIX 3: handle NaN')?.items.length, 3);
    assert.equal(splitBrief('PART 1: a\nPART 2: b\nPART 3: c')?.items.length, 3);
  });

  it('a brief naming 6+ files is split into passes of 3 files', () => {
    const plan = splitBrief('Rename foo to bar in a.ts b.ts c.ts d.ts e.ts f.ts g.ts')!;
    assert.equal(plan.kind, 'files');
    assert.deepEqual(plan.items.map((i) => i.files.length), [3, 3, 1]);
    assert.equal(splitBrief('Rename foo to bar in a.ts b.ts c.ts'), null);
    assert.deepEqual(filesIn('see e.g. this and v1.2 and src/x.ts'), ['src/x.ts']);
  });

  it('runs each fix as its own sub-task with its own prompt, reads named files first, reports per fix', async () => {
    const files = ['a', 'b', 'c'].map((n) => ({ path: `src/${n}.ts`, content: `export const ${n} = 1;\n` }));
    const prompts: string[] = [];
    let call_n = 0;
    const model = new MockLanguageModelV4({
      doStream: async (o: any) => {
        const first = JSON.stringify(o.prompt.find((m: any) => m.role === 'user')?.content);
        const fix = /FIX (\d)/.exec(first)?.[1] ?? '?';
        if (!prompts.includes(first)) prompts.push(first);
        const lastRole = o.prompt[o.prompt.length - 1].role;
        if (lastRole === 'tool') return step(text(`Changed src/${'abc'[Number(fix) - 1]}.ts.`), 'stop');
        call_n++;
        return step([call(`e${call_n}`, 'edit_file', { path: `src/${'abc'[Number(fix) - 1]}.ts`, old_string: '= 1', new_string: '= 2' })], 'tool-calls');
      },
    });
    const events: string[] = [];
    const r = await runToolAgent({ model, prompt: BRIEF.replace('tests/c.test.ts', 'src/c.ts'), projectName: 'P', files, maxSteps: 60, onEvent: (e) => events.push(e) });
    assert.equal(prompts.length, 3, 'one fresh conversation per fix');
    assert.match(prompts[0], /part 1 of 3 ONLY/);
    assert.match(prompts[1], /part 2 of 3 ONLY/);
    assert.doesNotMatch(prompts[0], /parse\(\) drops/, 'fix 1 does not see fix 2');
    assert.match(prompts[0], /First read these files, then make your first edit: src\/a\.ts/);
    assert.match(prompts[2], /ACCEPTANCE/);
    assert.equal(events.filter((e) => e === 'fix_start').length, 3);
    assert.match(r.text, /^FIX 1: done \(\d+ steps; files: src\/a\.ts\)/m);
    assert.match(r.text, /^FIX 3: done .*src\/c\.ts/m);
    assert.deepEqual(r.edits.map((e) => e.path), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
    assert.equal(r.paused, false);
  });

  it('a fix that makes no edit is called out, and the later fixes still run', async () => {
    const files = ['a', 'b', 'c'].map((n) => ({ path: `src/${n}.ts`, content: `export const ${n} = 1;\n` }));
    const model = new MockLanguageModelV4({
      doStream: async (o: any) => {
        const first = JSON.stringify(o.prompt.find((m: any) => m.role === 'user')?.content);
        const fix = Number(/FIX (\d)/.exec(first)?.[1]);
        if (o.prompt[o.prompt.length - 1].role === 'tool') return step(text('ok'), 'stop');
        if (fix === 2) return step(text('I could not find it.'), 'stop');
        return step([call(`e${fix}`, 'edit_file', { path: `src/${'abc'[fix - 1]}.ts`, old_string: '= 1', new_string: '= 2' })], 'tool-calls');
      },
    });
    const r = await runToolAgent({ model, prompt: BRIEF, projectName: 'P', files, maxSteps: 60 });
    assert.match(r.text, /^FIX 2: NO EDITS/m);
    assert.match(r.text, /^FIX 3: done/m);
    assert.equal(r.edits.length, 2);
  });

  it('pauses mid-fix with the remaining fixes saved, and a resumed segment finishes them all', async () => {
    const files = ['a', 'b', 'c'].map((n) => ({ path: `src/${n}.ts`, content: `export const ${n} = 1;\n` }));
    const mk = () => new MockLanguageModelV4({
      doStream: async (o: any) => {
        const first = JSON.stringify(o.prompt.find((m: any) => m.role === 'user')?.content);
        const fix = Number(/FIX (\d)/.exec(first)?.[1] ?? 1);
        const edited = JSON.stringify(o.prompt).includes('Edited ');
        if (o.prompt[o.prompt.length - 1].role === 'tool') return step(text('done it'), 'stop');
        return step([call(`e${fix}${edited}`, 'edit_file', { path: `src/${'abc'[fix - 1]}.ts`, old_string: '= 1', new_string: '= 2' })], 'tool-calls');
      },
    });
    let checkpoint: ModelMessage[] = [];
    const first = await runToolAgent({ model: mk(), prompt: BRIEF, projectName: 'P', files, maxSteps: 60, deadline: Date.now() - 1, onCheckpoint: (m) => { checkpoint = m; } });
    assert.equal(first.paused, true);
    assert.equal(first.subtasks?.current?.label, 'FIX 1');
    assert.deepEqual(first.subtasks?.pending.map((p) => p.label), ['FIX 2', 'FIX 3']);

    const second = await runToolAgent({ model: mk(), prompt: BRIEF, projectName: 'P', files, maxSteps: 60, resumeMessages: checkpoint, subtasks: first.subtasks });
    assert.equal(second.paused, false);
    assert.match(second.text, /^FIX 1:/m);
    assert.match(second.text, /^FIX 2:/m);
    assert.match(second.text, /^FIX 3:/m);
  });

  it('plan mode and ordinary briefs are not split', async () => {
    const model = new MockLanguageModelV4({ doStream: [step(text('Plan: ...'), 'stop')] });
    const r = await runToolAgent({ model, prompt: BRIEF, projectName: 'P', files: [], planMode: true });
    assert.equal(r.text, 'Plan: ...');
    assert.equal(model.doStreamCalls.length, 1);
  });
});
