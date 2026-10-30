import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';

async function setup() {
  const db = createTestDatabase();
  const repo = new DbRepo(db);
  await repo.createUser({ id: 'u1', email: 'a@x.com', name: 'A', passwordHash: 'h', role: 'user' });
  await repo.createUser({ id: 'u2', email: 'b@x.com', name: 'B', passwordHash: 'h', role: 'user' });
  return new PlatformRepo(db);
}

describe('Co-Work platform persistence', () => {
  it('claims a due job exactly once and reschedules recurring jobs', async () => {
    const p = await setup();
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    await p.createJob('u1', { kind: 'email', title: 'due', payload: { to: 'x' }, runAt: past });
    await p.createJob('u1', { kind: 'email', title: 'later', payload: {}, runAt: future });

    const first = await p.claimDueJobs();
    const second = await p.claimDueJobs();
    assert.deepEqual(first.map((j) => j.title), ['due']);
    assert.equal(second.length, 0, 'an overlapping cron run must not claim the same job');

    const next = new Date(Date.now() + 7 * 86400_000).toISOString();
    await p.finishJob(first[0], { ok: true, output: 'sent', nextRunAt: next });
    const job = await p.getJob('u1', first[0].id);
    assert.equal(job?.status, 'scheduled');
    assert.equal(job?.runAt, next);
    assert.equal((await p.listJobRuns('u1', first[0].id))[0].status, 'ok');
  });

  it('cancelled jobs are never claimed and other users cannot cancel them', async () => {
    const p = await setup();
    const job = await p.createJob('u1', { kind: 'email', title: 't', payload: {}, runAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(await p.setJobStatus('u2', job.id, 'cancelled'), false);
    assert.equal(await p.setJobStatus('u1', job.id, 'cancelled'), true);
    assert.equal((await p.claimDueJobs()).length, 0);
  });

  it('approves a pending action only once', async () => {
    const p = await setup();
    const a = await p.createPendingAction('u1', 'gmail_send', 'Send to x', { to: 'x' });
    assert.equal(await p.decidePendingAction('u1', a.id, 'approved'), true);
    assert.equal(await p.decidePendingAction('u1', a.id, 'approved'), false);
    assert.equal(await p.getPendingAction('u2', a.id), null);
  });

  it('upserts skills by slug with versioning and filters by mode', async () => {
    const p = await setup();
    await p.upsertSkill('u1', { name: 'Brand voice', slug: 'brand-voice', description: 'd', instructions: 'v1', modes: ['cowork'] });
    const s = await p.upsertSkill('u1', { name: 'Brand voice', slug: 'brand-voice', description: 'd', instructions: 'v2' });
    assert.equal(s.version, 2);
    assert.equal(s.instructions, 'v2');
    assert.equal((await p.listSkills('u1', 'code')).length, 0);
    assert.equal((await p.listSkills('u1', 'cowork')).length, 1);
    assert.equal((await p.listSkills('u2')).length, 0);
  });
});
