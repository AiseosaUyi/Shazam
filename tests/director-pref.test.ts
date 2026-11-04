import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';

describe('director user preference', () => {
  it('getUserPreferences for a user with no row returns director === auto', async () => {
    const db = createTestDatabase();
    const repo = new DbRepo(db);
    await repo.createUser({ id: 'u1', email: 'a@x.com', name: 'A', passwordHash: 'h', role: 'user' });

    const prefs = await repo.getUserPreferences('u1');
    assert.equal(prefs.director, 'auto', 'director should default to auto');
  });

  it('updateUserPreferences then getUserPreferences returns codex; other fields unchanged', async () => {
    const db = createTestDatabase();
    const repo = new DbRepo(db);
    await repo.createUser({ id: 'u2', email: 'b@x.com', name: 'B', passwordHash: 'h', role: 'user' });

    let prefs = await repo.getUserPreferences('u2');
    assert.equal(prefs.director, 'auto', 'should be auto by default');
    const preferLocalModelBefore = prefs.preferLocalModel;

    prefs = await repo.updateUserPreferences('u2', { director: 'codex' });
    assert.equal(prefs.director, 'codex', 'director should now be codex');

    const afterUpdate = await repo.getUserPreferences('u2');
    assert.equal(afterUpdate.director, 'codex', 'getUserPreferences should return codex');
    assert.equal(afterUpdate.preferLocalModel, preferLocalModelBefore, 'preferLocalModel should remain unchanged');
  });

  it('updating a different field keeps director, then changing it back works', async () => {
    const db = createTestDatabase();
    const repo = new DbRepo(db);
    await repo.createUser({ id: 'u3', email: 'c@x.com', name: 'C', passwordHash: 'h', role: 'user' });

    // Set director to codex first
    let prefs = await repo.updateUserPreferences('u3', { director: 'codex' });
    assert.equal(prefs.director, 'codex');

    // Update a different field — director should stay codex
    prefs = await repo.updateUserPreferences('u3', { monthlyBudgetUSD: 5 });
    assert.equal(prefs.director, 'codex', 'director should remain codex after updating monthlyBudgetUSD');

    // Now set it back to auto
    prefs = await repo.updateUserPreferences('u3', { director: 'auto' });
    const final = await repo.getUserPreferences('u3');
    assert.equal(final.director, 'auto', 'director should be auto now');
  });
});
