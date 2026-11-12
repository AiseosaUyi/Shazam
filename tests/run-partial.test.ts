import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pauseOutcome, MAX_SEGMENTS } from '@/lib/runs/background';
import { buildReport, formatPartial, remainingTodos } from '@/lib/runs/report';
import { durationNote, stepsPerMinute } from '@/lib/runs/estimate';
import { isTerminalStatus } from '@/lib/runs/repo';

describe('Partial results instead of dead errors (P0-C)', () => {
  it('reaching the segment cap is "partial", not an error', () => {
    assert.equal(pauseOutcome({ agent: 'code', segment: MAX_SEGMENTS - 1, prompt: 'Add a helper', editsMade: 3 }), 'partial');
    assert.equal(pauseOutcome({ agent: 'code', segment: 2, prompt: 'Add a helper', editsMade: 3 }), 'continue');
  });

  it('aborts early when the first 2 segments produced no edits', () => {
    assert.equal(pauseOutcome({ agent: 'code', segment: 0, prompt: 'Fix the bug', editsMade: 0 }), 'continue');
    assert.equal(pauseOutcome({ agent: 'code', segment: 1, prompt: 'Fix the bug', editsMade: 0 }), 'early_abort');
    assert.equal(pauseOutcome({ agent: 'code', segment: 1, prompt: 'Fix the bug', editsMade: 1 }), 'continue');
  });

  it('does not early-abort a question, or a cowork run', () => {
    assert.equal(pauseOutcome({ agent: 'code', segment: 1, prompt: 'Explain the bridge', editsMade: 0 }), 'continue');
    assert.equal(pauseOutcome({ agent: 'cowork', segment: 1, prompt: 'Fix my calendar', editsMade: 0 }), 'continue');
  });

  it('partial and stalled are final states, so a poller stops waiting', () => {
    for (const s of ['partial', 'stalled', 'no_changes', 'done', 'error', 'cancelled']) assert.equal(isTerminalStatus(s), true, s);
    for (const s of ['queued', 'running', 'paused']) assert.equal(isTerminalStatus(s), false, s);
  });

  it('the partial result lists files so far, remaining todo, and the diff stat', () => {
    const record = { edits: [{ path: 'src/a.ts', action: 'edit' as const, added: 4, removed: 1 }], commands: [] };
    const report = buildReport({ prompt: 'Refactor a', record, segmentsUsed: 8 });
    const events = [
      { type: 'plan', text: JSON.stringify([{ content: 'edit a.ts', status: 'completed' }, { content: 'update tests', status: 'pending' }, { content: 'run tsc', status: 'in_progress' }]) },
      { type: 'step', text: 'read_file' },
    ];
    assert.deepEqual(remainingTodos(events), ['update tests', 'run tsc']);
    const out = formatPartial(report, { segments: 8, capMinutes: 60, todos: remainingTodos(events), diffStat: ' src/a.ts | 5 ++++-\n 1 file changed' });
    assert.match(out, /^PARTIAL: stopped at the time cap \(8 segments, about 60 min\)/);
    assert.match(out, /src\/a\.ts \(\+4\/-1\)/);
    assert.match(out, /Remaining todo: update tests; run tsc/);
    assert.match(out, /git diff --stat:\nsrc\/a\.ts \| 5/);
    assert.match(out, /Send feedback to continue/);
    assert.equal(report.segmentsUsed, 8);
  });

  it('remainingTodos is empty with no plan', () => {
    assert.deepEqual(remainingTodos([{ type: 'step', text: 'x' }]), []);
  });
});

describe('Duration estimate at task start', () => {
  const run = (model: string, steps: number, minutes: number) => ({
    model, status: 'done', agent: 'code',
    events: Array.from({ length: steps }, () => ({ type: 'step', at: '' })),
    createdAt: '2026-11-12T10:00:00.000Z',
    updatedAt: new Date(Date.parse('2026-11-12T10:00:00.000Z') + minutes * 60_000).toISOString(),
  });

  it('measures steps per minute per model and ignores other models', () => {
    const rate = stepsPerMinute([run('Qwen local', 60, 30), run('Qwen local', 40, 20), run('Gemini', 100, 5)], 'qwen');
    assert.equal(rate, 2);
    assert.equal(stepsPerMinute([run('Gemini', 100, 5)], 'qwen'), null);
    assert.equal(stepsPerMinute([]), null);
  });

  it('warns when the step budget will not fit the cap, and states the cap otherwise', () => {
    const warn = durationNote({ maxSteps: 120, capMinutes: 60, maxSegments: 8, rate: 1, model: 'qwen' });
    assert.match(warn, /WARNING: at the measured 1\.0 steps\/min on qwen, 120 steps take about 120 min, over the 60 min cap/);
    const ok = durationNote({ maxSteps: 120, capMinutes: 60, maxSegments: 8, rate: 6 });
    assert.doesNotMatch(ok, /WARNING/);
    assert.match(ok, /Estimate: about 20 min/);
    assert.match(durationNote({ maxSteps: 120, capMinutes: 60, maxSegments: 8, rate: null }), /Time cap: 8 segments \(about 60 min\)\. If it is hit you get a partial result, not an error\./);
  });
});
