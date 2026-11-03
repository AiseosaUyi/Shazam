import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';
import { localLeads } from '@/lib/agent/resolve';

describe('localLeads routing preference', () => {
  it('defaults to leading when settings is null / undefined', () => {
    assert.equal(localLeads(null, null), true);
    assert.equal(localLeads(undefined, undefined), true);
  });

  it('leads when preferLocalModel is true', () => {
    assert.equal(localLeads(null, { preferLocalModel: true }), true);
  });

  it('does not lead when preferLocalModel is false', () => {
    assert.equal(localLeads(null, { preferLocalModel: false }), false);
  });

  it('pinning local always leads regardless of preferLocalModel', () => {
    assert.equal(localLeads('local', { preferLocalModel: false }), true);
  });

  it('pinning another model never leads even with preferLocalModel true', () => {
    assert.equal(
      localLeads('gemini-2.5-flash', { preferLocalModel: true }),
      false,
    );
  });
});

describe('settings schema round-trip via repo', () => {
  it('persist and read back preferLocalModel = false', async () => {
    const db = createTestDatabase();
    const repo = new DbRepo(db);

    await repo.createUser({
      id: 'u1',
      email: 'a@x.com',
      name: 'A',
      passwordHash: 'h',
      role: 'user',
    });

    await repo.updateUserPreferences('u1', { preferLocalModel: false });

    const prefs = await repo.getUserPreferences('u1');
    assert.equal(prefs.preferLocalModel, false);
    assert.equal(localLeads(null, prefs), false);
  });
});
