import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';
import { QuestionsRepo, buildAskTool, MAX_QUESTIONS_PER_TASK } from '@/lib/agents/ask';

describe('ask_user: pause, answer, resume', () => {
  it('waits for the answer and enforces the question budget', async () => {
    const db = createTestDatabase();
    await new DbRepo(db).createUser({ id: 'u1', email: 'a@x.com', name: 'A', passwordHash: 'h', role: 'user' });
    const repo = new QuestionsRepo(db);
    const events: Array<{ e: string; d: any }> = [];
    const { ask_user } = buildAskTool({ userId: 'u1', runId: 'run_1', repo, onEvent: (e, d) => events.push({ e, d }) }) as any;

    const pending = ask_user.execute({ question: 'Who should receive the launch email?', options: ['The whole team', 'Just founders'] }, {} as any);
    await new Promise((r) => setTimeout(r, 50));
    const asked = events.find((x) => x.e === 'question')!.d;
    assert.equal((await repo.pendingForRun('u1', 'run_1'))?.id, asked.id);
    assert.equal(await repo.answer('u2', asked.id, 'nope'), false, 'other users cannot answer');
    assert.equal(await repo.answer('u1', asked.id, 'Just founders'), true);
    assert.match(await pending, /Just founders/);

    for (let i = 1; i < MAX_QUESTIONS_PER_TASK; i++) {
      const p = ask_user.execute({ question: `q${i} is long enough?`, options: ['a', 'b'] }, {} as any);
      await new Promise((r) => setTimeout(r, 30));
      const q = events.filter((x) => x.e === 'question').pop()!.d;
      await repo.answer('u1', q.id, 'a');
      await p;
    }
    assert.match(await ask_user.execute({ question: 'one more question?', options: ['a', 'b'] }, {} as any), /budget/);
  });
});
