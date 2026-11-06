import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';
import { RunsRepo } from '@/lib/runs/repo';

async function setup() {
  const db = createTestDatabase();
  const repo = new DbRepo(db);
  await repo.createUser({ id: 'u1', email: 'a@x.com', name: 'A', passwordHash: 'h', role: 'user' });
  await repo.createUser({ id: 'u2', email: 'b@x.com', name: 'B', passwordHash: 'h', role: 'user' });
  return new RunsRepo(db);
}

describe('Stopping a run', () => {
  it('cancels a running run and records a note', async () => {
    const runs = await setup();
    const run = await runs.create('u1', { agent: 'code', prompt: 'build' });
    await runs.update('u1', run.id, { status: 'running' });
    assert.equal(await runs.cancel('u1', run.id), true);
    const after = await runs.get('u1', run.id);
    assert.equal(after?.status, 'cancelled');
    assert.match(after!.events.at(-1)!.text || '', /Stopped by you/);
  });

  it('stays cancelled even if the runner later reports done or error', async () => {
    const runs = await setup();
    const run = await runs.create('u1', { agent: 'code', prompt: 'build' });
    await runs.cancel('u1', run.id);
    await runs.update('u1', run.id, { status: 'done', result: 'late result' });
    await runs.update('u1', run.id, { status: 'error', error: 'AbortError' });
    assert.equal((await runs.get('u1', run.id))?.status, 'cancelled');
  });

  it('cannot cancel a finished run or someone else\'s run', async () => {
    const runs = await setup();
    const run = await runs.create('u1', { agent: 'code', prompt: 'build' });
    await runs.update('u1', run.id, { status: 'done', result: 'ok' });
    assert.equal(await runs.cancel('u1', run.id), false);
    const other = await runs.create('u1', { agent: 'code', prompt: 'x' });
    assert.equal(await runs.cancel('u2', other.id), false);
    assert.equal((await runs.get('u1', other.id))?.status, 'queued');
  });
});
