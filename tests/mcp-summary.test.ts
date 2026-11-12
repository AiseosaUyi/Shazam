import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun, SUMMARY_RESULT_CHARS } from '../src/lib/runs/mcp-summary';

const events = Array.from({ length: 12 }, (_, i) => ({ type: 'step', text: `step ${i}` }));
const longResult = 'x'.repeat(SUMMARY_RESULT_CHARS + 500);

test('summary shows only the last 5 progress lines and a shortened result', () => {
  const out = summarizeRun({ id: 'r1', agent: 'code', status: 'done', events, result: longResult });
  assert.match(out, /last 5 of 12 new/);
  assert.match(out, /11\. \[step\] step 11/);
  assert.doesNotMatch(out, /6\. \[step\] step 6\n/);
  assert.match(out, /Shortened\. Call get_task_status with detail="full"/);
  assert.ok(out.length < SUMMARY_RESULT_CHARS + 600);
});

test('full detail returns the whole result and more progress', () => {
  const out = summarizeRun({ id: 'r1', agent: 'code', status: 'done', events, result: longResult }, 0, 'full');
  assert.doesNotMatch(out, /Shortened/);
  assert.match(out, /0\. \[step\] step 0/);
  assert.ok(out.includes(longResult));
});

test('since_event numbering stays correct', () => {
  const out = summarizeRun({ id: 'r1', agent: 'code', status: 'running', events }, 10);
  assert.match(out, /10\. \[step\] step 10/);
  assert.match(out, /11\. \[step\] step 11/);
  assert.doesNotMatch(out, /Still working/);
});

const longDump = Array.from({ length: 200 }, (_, i) => `${i + 1}\texport const line${i} = ${i};`).join('\n');

test('progress is one short line per event: no file contents or old_string dumps', () => {
  const evs = [
    { type: 'step', text: 'read_file {"path":"src/a.ts","offset":1}' },
    { type: 'result', text: `src/a.ts (200 lines)\n${longDump}` },
    { type: 'step', text: 'edit_file {"path":"src/a.ts","old_string":"' + 'x'.repeat(150) },
    { type: 'result', text: 'Edited src/a.ts (1 replacement).' },
  ];
  const out = summarizeRun({ id: 'r1', agent: 'code', status: 'running', events: evs });
  assert.match(out, /0\. \[step\] read_file src\/a\.ts/);
  assert.match(out, /1\. \[result\] src\/a\.ts \(200 lines\)/);
  assert.match(out, /2\. \[step\] edit_file src\/a\.ts/);
  assert.doesNotMatch(out, /export const line/);
  assert.doesNotMatch(out, /xxxxx/);
  assert.ok(out.length < 700, `compact, got ${out.length}`);
});

test('always includes files changed, edits_count, tests_status, status and steps_since_last_edit', () => {
  const evs = [
    { type: 'step', text: 'edit_file {"path":"a.ts"}' }, { type: 'file', text: 'a.ts' },
    { type: 'step', text: 'run_command {"command":"npm test"}' }, { type: 'result', text: '$ npm test\nexit code: 1\nFAIL' },
    { type: 'step', text: 'read_file {"path":"a.ts"}' },
  ];
  const out = summarizeRun({ id: 'r1', agent: 'code', status: 'running', events: evs });
  assert.match(out, /status: running/);
  assert.match(out, /files changed: a\.ts/);
  assert.match(out, /edits_count: 1 · tests_status: failed · steps_since_last_edit: 2/);
});

test('a finished run reports facts from its saved report', () => {
  const report = { filesChanged: [{ path: 'a.ts', added: 3, removed: 1 }], editsCount: 2, testsStatus: 'passed', segmentsUsed: 3, warnings: ['external_changes_detected'] };
  const out = summarizeRun({ id: 'r1', agent: 'code', status: 'done', events: [], result: 'ok', options: { report }, segment: 2 });
  assert.match(out, /files changed: a\.ts \(\+3\/-1\)/);
  assert.match(out, /edits_count: 2 · tests_status: passed · steps_since_last_edit: 0 · segments_used: 3/);
  assert.match(out, /warnings: external_changes_detected/);
});

test('partial, stalled and no_changes show their result', () => {
  for (const status of ['partial', 'stalled', 'no_changes']) assert.match(summarizeRun({ id: 'r', agent: 'code', status, events: [], result: 'why it stopped' }), /RESULT:\nwhy it stopped/);
});
