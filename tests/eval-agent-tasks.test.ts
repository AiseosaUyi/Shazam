import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadTasks } from '../evals/agent/lib';
import { validateTask } from '../evals/agent/validate';

// Self-verifying agent benchmark (C11): every task's checker must fail on the starting files and
// pass on the bundled reference solution, so a broken task fails CI.
describe('agent eval suite (dry validation)', () => {
  const tasks = loadTasks();

  it('has 20 tasks with unique names', () => {
    assert.equal(tasks.length, 20);
    assert.equal(new Set(tasks.map((t) => t.name)).size, 20);
  });

  for (const task of tasks) {
    it(`${task.name}: checker fails on start, passes on solution`, () => {
      const r = validateTask(task);
      assert.ok(r.ok, r.detail);
    });
  }
});
