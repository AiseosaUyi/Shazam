import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';

describe('preferLocalModel user preference', () => {
  it('getUserPreferences for a user with no row returns preferLocalModel === true', async () => {
    const db = createTestDatabase();
    const repo = new DbRepo(db);
    await repo.createUser({ id: 'u1', email: 'a@x.com', name: 'A', passwordHash: 'h', role: 'user' });

    const prefs = await repo.getUserPreferences('u1');
    assert.equal(prefs.preferLocalModel, true, 'preferLocalModel should default to true');
  });

  it('updateUserPreferences then getUserPreferences returns false; other fields unchanged', async () => {
    const db = createTestDatabase();
    const repo = new DbRepo(db);
    await repo.createUser({ id: 'u2', email: 'b@x.com', name: 'B', passwordHash: 'h', role: 'user' });

    let prefs = await repo.getUserPreferences('u2');
    assert.equal(prefs.preferLocalModel, true, 'should be true by default');
    const autoFallbackBefore = prefs.autoFallbackEnabled;
    assert.equal(autoFallbackBefore, true, 'autoFallbackEnabled should be true by default');

    prefs = await repo.updateUserPreferences('u2', { preferLocalModel: false });
    assert.equal(prefs.preferLocalModel, false, 'preferLocalModel should now be false');

    const afterUpdate = await repo.getUserPreferences('u2');
    assert.equal(afterUpdate.preferLocalModel, false, 'getUserPreferences should return false');
    assert.equal(afterUpdate.autoFallbackEnabled, autoFallbackBefore, 'autoFallbackEnabled should remain unchanged');
  });

  it('updating a different field keeps preferLocalModel, then changing it back works', async () => {
    const db = createTestDatabase();
    const repo = new DbRepo(db);
    await repo.createUser({ id: 'u3', email: 'c@x.com', name: 'C', passwordHash: 'h', role: 'user' });

    // Set preferLocalModel to false first
    let prefs = await repo.updateUserPreferences('u3', { preferLocalModel: false });
    assert.equal(prefs.preferLocalModel, false);

    // Update a different field — preferLocalModel should stay false
    prefs = await repo.updateUserPreferences('u3', { monthlyBudgetUSD: 5 });
    assert.equal(prefs.preferLocalModel, false, 'preferLocalModel should remain false after updating monthlyBudgetUSD');

    // Now set it back to true
    prefs = await repo.updateUserPreferences('u3', { preferLocalModel: true });
    const final = await repo.getUserPreferences('u3');
    assert.equal(final.preferLocalModel, true, 'preferLocalModel should be true now');
  });
});
