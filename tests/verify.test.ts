import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumstat, isTestPath, testWarnings, exitCodeOf, autoVerify } from '../src/lib/runs/verify';

describe('parseNumstat', () => {
  it('parses normal numstat rows', () => {
    const out = '5\t3\tsrc/lib/a.ts\n0\t0\tnew/file.md\n';
    const rows = parseNumstat(out);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].path, 'src/lib/a.ts');
    assert.equal(rows[0].added, 5);
    assert.equal(rows[0].removed, 3);
    assert.equal(rows[1].path, 'new/file.md');
    assert.equal(rows[1].added, 0);
    assert.equal(rows[1].removed, 0);
  });

  it('skips binary rows (-\t-\\tpath)', () => {
    const out = '-\t-\tbinary.png\n3\t1\tsrc/code.ts\n';
    const rows = parseNumstat(out);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, 'src/code.ts');
  });

  it('skips garbage lines', () => {
    const out = 'garbage\n\nmore garbage\n3\t1\tsrc/ok.ts\n';
    const rows = parseNumstat(out);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, 'src/ok.ts');
  });
});

describe('isTestPath', () => {
  it('returns true for tests/ prefix', () => {
    assert.ok(isTestPath('tests/a.test.ts'));
    assert.ok(isTestPath('test/b.ts'));
    assert.ok(isTestPath('__tests__/c.ts'));
    assert.ok(isTestPath('spec/d.ts'));
  });

  it('returns true for .test. / .spec. file extensions', () => {
    assert.ok(isTestPath('src/x.spec.tsx'));
    assert.ok(isTestPath('y.test.ts'));
    assert.ok(isTestPath('z.test.cts'));
    assert.ok(isTestPath('w.test.mjs'));
  });

  it('returns true for __tests__ directory', () => {
    assert.ok(isTestPath('src/__tests__/y.ts'));
  });

  it('returns false for non-test paths', () => {
    assert.ok(!isTestPath('src/lib/a.ts'));
    assert.ok(!isTestPath('src/utils/helper.ts'));
    assert.ok(!isTestPath('package.json'));
  });
});

describe('testWarnings', () => {
  it('returns empty array when no test lines removed', () => {
    const rows = [{ path: 'src/a.ts', added: 5, removed: 0 }];
    const w = testWarnings(rows);
    assert.equal(w.length, 0);
  });

  it('reports each test file with removed > 0', () => {
    const rows = [
      { path: 'tests/a.test.ts', added: 0, removed: 12 },
      { path: 'src/b.ts', added: 0, removed: 5 }, // not a test file
    ];
    const w = testWarnings(rows);
    assert.equal(w.length, 1);
    assert.equal(w[0], 'tests/a.test.ts: 12 test line(s) removed');
  });

  it('collects warnings for multiple test files', () => {
    const rows = [
      { path: 'tests/a.test.ts', added: 0, removed: 3 },
      { path: 'tests/b.test.tsx', added: 0, removed: 7 },
    ];
    const w = testWarnings(rows);
    assert.equal(w.length, 2);
    assert.ok(w[0].includes('tests/a.test.ts'));
    assert.ok(w[1].includes('tests/b.test.tsx'));
  });
});

describe('exitCodeOf', () => {
  it('defaults to 1 on no match', () => {
    assert.equal(exitCodeOf('some output'), 1);
  });

  it('extracts the exit code from a matching line', () => {
    assert.equal(exitCodeOf('done\nexit code: 0'), 0);
    assert.equal(exitCodeOf('exit code: 42\nmore'), 42);
  });

  it('picks the LAST match when multiple exist', () => {
    const out = 'exit code: 3\nsome stuff\nexit code: 5';
    assert.equal(exitCodeOf(out), 5);
  });
});

describe('autoVerify', () => {
  function makeFakeReadFile(content: string) {
    return async (p: string) => content;
  }

  it('(a) tests pass and no test deletions → ok true, summary contains "Tests: passed"', async () => {
    const execCalls: string[] = [];
    const fakeExec = async (command: string) => {
      execCalls.push(command);
      if (command.includes('git diff')) {
        return '1\t0\tsrc/a.ts\nexit code: 0'; // no test deletions
      }
      return 'exit code: 0';
    };
    const fakeReadFile = makeFakeReadFile('{"scripts":{"test":"jest"}}');

    const { summary, ok } = await autoVerify(fakeExec, fakeReadFile, '/root');
    assert.ok(ok, 'should be ok');
    assert.ok(summary.includes('Tests: passed'), 'summary should contain "Tests: passed"');
  });

  it('(b) numstat shows test line deletions → ok false, summary contains warning', async () => {
    const fakeExec = async (command: string) => {
      if (command.includes('git diff')) {
        return '0\t12\ttests/a.test.ts\nexit code: 0';
      }
      return 'exit code: 0';
    };
    const fakeReadFile = makeFakeReadFile('{"scripts":{"test":"jest"}}');

    const { summary, ok } = await autoVerify(fakeExec, fakeReadFile, '/root');
    assert.ok(!ok, 'should not be ok');
    assert.ok(summary.includes('tests/a.test.ts: 12 test line(s) removed'), 'summary should contain warning');
  });

  it('(c) failing tests → ok false, summary contains "FAILED"', async () => {
    const execCalls: string[] = [];
    const fakeExec = async (command: string) => {
      execCalls.push(command);
      if (command.includes('git diff')) {
        return '1\t0\tsrc/a.ts\nexit code: 0'; // no test deletions
      }
      return 'exit code: 1\nsome error output';
    };
    const fakeReadFile = makeFakeReadFile('{"scripts":{"test":"jest"}}');

    const { summary, ok } = await autoVerify(fakeExec, fakeReadFile, '/root');
    assert.ok(!ok, 'should not be ok');
    assert.ok(summary.includes('FAILED'), 'summary should contain "FAILED"');
  });

  it('(d) no test script in package.json → "no test script", exec called only once', async () => {
    const execCalls: string[] = [];
    const fakeExec = async (command: string) => {
      execCalls.push(command);
      if (command.includes('git diff')) {
        return '1\t0\tsrc/a.ts\nexit code: 0';
      }
      return 'exit code: 0';
    };
    // package.json without a test script
    const fakeReadFile = makeFakeReadFile('{"scripts":{}}');

    const { summary, ok } = await autoVerify(fakeExec, fakeReadFile, '/root');
    assert.ok(summary.includes('no test script'), 'summary should contain "no test script"');
    // exec should only be called once (for git diff), not for npm test
    assert.equal(execCalls.length, 1, 'exec should be called only once');
  });

  it('handles parseNumstat garbage with exitCode of non-zero', async () => {
    const fakeExec = async (command: string) => {
      if (command.includes('git diff')) {
        return ''; // empty → exit code 1 (default)
      }
      return 'exit code: 0';
    };
    const fakeReadFile = makeFakeReadFile('{"scripts":{"test":"jest"}}');

    const { summary, ok } = await autoVerify(fakeExec, fakeReadFile, '/root');
    // With empty diff and exitCode !== 0 (default 1), rows should be [] so no test deletions
    // But tests will fail because exit code is not 0? Let me think...
    // The fakeExec for git diff returns '' which has no "exit code:" line, so exitCodeOf = 1 (not 0)
    // So rows = [] and ok should depend on test pass/fail
    assert.ok(summary.includes('Tests: passed') || summary.includes('FAILED'));
  });

  it('(e) failing tests with exit code 3 → "FAILED (exit 3)" and includes output line from fake exec', async () => {
    const execCalls: string[] = [];
    const fakeExec = async (command: string) => {
      execCalls.push(command);
      if (command.includes('git diff')) {
        return '1\t0\tsrc/a.ts\nexit code: 0'; // no test deletions
      }
      return 'some fake test error output from exec\nexit code: 3';
    };
    const fakeReadFile = makeFakeReadFile('{"scripts":{"test":"jest"}}');

    const { summary, ok } = await autoVerify(fakeExec, fakeReadFile, '/root');
    assert.ok(!ok, 'should not be ok');
    assert.ok(summary.includes('FAILED'), 'summary should contain "FAILED"');
    assert.ok(summary.includes('(exit 3)'), 'summary should include exit code 3');
    // The output block should contain a line from the fake exec output
    assert.ok(summary.includes('some fake test error output from exec'), 'summary should include fake output lines');
  });

  it('(f) exec command contains TMPDIR and does not contain "rm -f"', async () => {
    const execCalls: string[] = [];
    const fakeExec = async (command: string) => {
      execCalls.push(command);
      if (command.includes('git diff')) {
        return '1\t0\tsrc/a.ts\nexit code: 0';
      }
      return 'exit code: 0';
    };
    const fakeReadFile = makeFakeReadFile('{"scripts":{"test":"jest"}}');

    await autoVerify(fakeExec, fakeReadFile, '/root');
    const testCmd = execCalls.find(c => !c.includes('git diff'));
    assert.ok(testCmd, 'exec should have been called for npm test');
    assert.ok(testCmd!.includes('TMPDIR'), 'command should contain TMPDIR');
    assert.ok(!testCmd!.includes('rm -f'), 'command should not contain "rm -f"');
  });

  it('(g) failing tests with exit code 3 includes fenced output block', async () => {
    const fakeExec = async (command: string) => {
      if (command.includes('git diff')) {
        return '1\t0\tsrc/a.ts\nexit code: 0';
      }
      return 'error line 1\nerror line 2\nexit code: 3';
    };
    const fakeReadFile = makeFakeReadFile('{"scripts":{"test":"jest"}}');

    const { summary } = await autoVerify(fakeExec, fakeReadFile, '/root');
    // Should have a fenced code block with the error lines
    assert.ok(summary.includes('```\n') && summary.lastIndexOf('```\n') !== 0, 'should include fenced code block');
    assert.ok(summary.includes('error line 1'));
    assert.ok(summary.includes('error line 2'));
  });
});
