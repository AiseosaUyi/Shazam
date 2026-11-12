import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, formatResult, sanitizeSummary, detectExternalChanges, parseGitStatus, parseCommitHash, promptAsksForChanges, testsStatus, mergeRecords, type RunRecord } from '@/lib/runs/report';

const edit = (path: string, added = 2, removed = 1) => ({ path, action: 'edit' as const, added, removed });
const rec = (over: Partial<RunRecord> = {}): RunRecord => ({ edits: [], commands: [], ...over });

describe('Truthful run report (P0-A)', () => {
  it('a run with no edits cannot be "done" when the prompt asked for changes', () => {
    const r = buildReport({ prompt: 'Fix the off-by-one in src/range.ts', record: rec() });
    assert.equal(r.status, 'no_changes');
    assert.match(formatResult(r, 'All fixed and committed!', rec()), /NO CHANGES MADE/);
  });

  it('a question or review with no edits is still "done"', () => {
    assert.equal(buildReport({ prompt: 'Explain how the bridge works', record: rec() }).status, 'done');
    assert.equal(buildReport({ prompt: 'Review src/lib/runs/background.ts', record: rec() }).status, 'done');
  });

  it('a run with a recorded edit is "done" and lists files with line counts', () => {
    const record = rec({ edits: [edit('src/a.ts', 3, 1), edit('src/a.ts', 2, 2), edit('src/b.ts', 5, 0)] });
    const r = buildReport({ prompt: 'Add a clamp helper', record });
    assert.equal(r.status, 'done');
    assert.deepEqual(r.filesChanged, [{ path: 'src/a.ts', added: 5, removed: 3 }, { path: 'src/b.ts', added: 5, removed: 0 }]);
    assert.equal(r.editsCount, 3);
  });

  it('removes a commit hash the run did not create, keeps one it did', () => {
    const record = rec({ edits: [edit('a.ts')], commands: [{ command: 'git commit -m x', exitCode: 0, commit: 'abc1234' }] });
    const out = sanitizeSummary('Committed abc1234 on top of 9f2e7d1c4b.', record);
    assert.match(out, /abc1234/);
    assert.doesNotMatch(out, /9f2e7d1c4b/);
    assert.match(out, /\[unverified hash removed\]/);
  });

  it('does not strip ordinary words that look like hex', () => {
    assert.equal(sanitizeSummary('Added decade and facade helpers', rec()), 'Added decade and facade helpers');
  });

  it('removes a file named in a "changed" claim that has no recorded edit', () => {
    const out = sanitizeSummary('Updated src/a.ts and src/ghost.ts.\nSee README.md for details.', rec({ edits: [edit('src/a.ts')] }));
    assert.match(out, /src\/a\.ts/);
    assert.doesNotMatch(out, /ghost/);
    assert.match(out, /README\.md/);
  });

  it('flags a HEAD that moved without a commit from this run', () => {
    const before = { head: 'a'.repeat(40), dirty: {} };
    const after = { head: 'b'.repeat(40), dirty: {} };
    const w = detectExternalChanges(before, after, rec({ edits: [edit('x.ts')] }));
    assert.equal(w.length, 1);
    assert.match(w[0], /Someone else committed/);
    const r = buildReport({ prompt: 'Add x', record: rec({ edits: [edit('x.ts')] }), gitBefore: before, gitAfter: after });
    assert.ok(r.warnings.includes('external_changes_detected'));
  });

  it('lists files changed in the tree that the run did not edit, and ignores pre-existing dirt', () => {
    const before = { head: 'a'.repeat(40), dirty: { 'old.ts': ' M' } };
    const after = { head: 'a'.repeat(40), dirty: { 'old.ts': ' M', 'mine.ts': ' M', 'theirs.ts': ' M' } };
    const w = detectExternalChanges(before, after, rec({ edits: [edit('mine.ts')] }));
    assert.equal(w.length, 1);
    assert.match(w[0], /theirs\.ts/);
    assert.doesNotMatch(w[0], /mine\.ts|old\.ts/);
  });

  it('is quiet when there is no git state', () => {
    assert.deepEqual(detectExternalChanges(null, null, rec()), []);
  });

  it('tests_status comes from the last test command exit code', () => {
    assert.equal(testsStatus([]), 'not_run');
    assert.equal(testsStatus([{ command: 'npm test', exitCode: 1 }, { command: 'npm test', exitCode: 0 }]), 'passed');
    assert.equal(testsStatus([{ command: 'node --test tests/a.test.ts', exitCode: 1 }]), 'failed');
    assert.equal(testsStatus([{ command: 'ls', exitCode: 0 }]), 'not_run');
  });

  it('parses git output and merges segment records', () => {
    assert.equal(parseCommitHash('[main 7f26909] docs: x\n 1 file changed'), '7f26909');
    assert.deepEqual(parseGitStatus('exit code: 0\n M src/a.ts\n?? new.ts\nR  old.ts -> renamed.ts\n'), { 'src/a.ts': ' M', 'new.ts': '??', 'renamed.ts': 'R ' });
    const m = mergeRecords(rec({ edits: [edit('a.ts')] }), { edits: [edit('b.ts')], commands: [{ command: 'ls', exitCode: 0 }] });
    assert.equal(m.edits.length, 2);
    assert.equal(m.commands.length, 1);
  });

  it('prompt classifier', () => {
    assert.equal(promptAsksForChanges('Implement debounce in src/d.ts'), true);
    assert.equal(promptAsksForChanges('Reviewer feedback on your previous work — address every point:\nrename foo to bar'), true);
    assert.equal(promptAsksForChanges('What does the stall guard do?'), false);
  });
});
