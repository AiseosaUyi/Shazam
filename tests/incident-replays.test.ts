import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { runToolAgent } from '../src/lib/agent/tool_agent';
import { buildReport, formatResult, mergeRecords, emptyRecord } from '../src/lib/runs/report';
import { summarizeRun } from '../src/lib/runs/mcp-summary';

const usage: any = { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } };
const step = (parts: any[], unified: 'tool-calls' | 'stop'): any => ({ stream: simulateReadableStream({ chunks: [...parts, { type: 'finish', finishReason: { unified, raw: unified }, usage }] }) });
const text = (t: string) => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown) => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });

/**
 * Incident 1 replayed end to end: the user committed to the same working tree during the run; the
 * model ran `git diff --stat HEAD~1`, saw the user's commit, and reported it as its own work with
 * test counts that match nothing it ran. None of its own edits landed.
 */
describe('Incident replay: false "done" (P0-A)', () => {
  it('reports no_changes, no foreign commit hash, and the recorded facts instead of the claims', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        step([call('1', 'run_command', { command: 'git diff --stat HEAD~1' })], 'tool-calls'),
        step(text('Done. Committed 9f2e7d1c4b with src/a.ts, src/b.ts changed. All 47 tests pass.'), 'stop'),
      ],
    });
    const out = await runToolAgent({
      model,
      prompt: 'Fix the clamp bug in src/a.ts and add a test',
      projectName: 'P',
      files: [],
      runCommand: async () => ({ exitCode: 0, output: ' src/other.ts | 3 ++-\n' }),
    });
    const record = mergeRecords(emptyRecord(), { edits: out.edits, commands: out.commandsRun });
    const user = { head: 'a'.repeat(40), dirty: {} };
    const report = buildReport({ prompt: 'Fix the clamp bug in src/a.ts and add a test', record, gitBefore: user, gitAfter: { head: '9f2e7d1c4b' + '0'.repeat(30), dirty: {} } });
    const result = formatResult(report, out.text, record);

    assert.equal(report.status, 'no_changes');
    assert.match(result, /NO CHANGES MADE/);
    assert.match(result, /Someone else committed/);
    assert.doesNotMatch(result, /9f2e7d1c4b with/, 'foreign hash removed from the summary');
    assert.doesNotMatch(result, /src\/b\.ts changed/, 'file with no recorded edit removed from the claim');
    assert.match(result, /Files changed by this run: none/);
    assert.match(result, /Commits made by this run: none/);
    assert.match(result, /Tests: not_run/);
  });
});

describe('Director cost: one poll of a busy run stays small (P1-A)', () => {
  it('a run with 100 steps of file reads summarizes in well under 1.5 KB', () => {
    const dump = Array.from({ length: 200 }, (_, i) => `${i}\tconst x${i} = ${i};`).join('\n');
    const events = Array.from({ length: 100 }, (_, i) => (i % 2 ? { type: 'result', text: `a.ts (200 lines)\n${dump}` } : { type: 'step', text: 'read_file {"path":"a.ts"}' }));
    const out = summarizeRun({ id: 'r', agent: 'code', status: 'running', events });
    assert.ok(out.length < 1500, `got ${out.length}`);
  });
});
