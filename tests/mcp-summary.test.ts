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
  assert.match(out, /Still working\. Call get_task_status again right away/);
});
