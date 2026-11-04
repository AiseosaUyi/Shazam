import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';
import { PlatformRepo } from '@/lib/db/platform-repo';
import { buildSkillTools } from '@/lib/skills';

function makeDbAndUser(): { db: ReturnType<typeof createTestDatabase>; userId: string } {
  const db = createTestDatabase();
  const repo = new DbRepo(db);
  void repo.createUser({ id: 'tu1', email: 't@x.com', name: 'T', passwordHash: 'h', role: 'user' });
  return { db, userId: 'tu1' };
}

function makePlatform(userId: string) {
  const { db } = makeDbAndUser();
  return new PlatformRepo(db);
}

async function ensureUser(p: PlatformRepo, repo: DbRepo) {
  try {
    await repo.createUser({ id: 'tu1', email: 't@x.com', name: 'T', passwordHash: 'h', role: 'user' });
  } catch {
    // already exists
  }
}

describe('skills save_skill tool', () => {
  it('with zero skills, buildSkillTools returns a save_skill tool and an inventory containing "save_skill"', async () => {
    const db = createTestDatabase();
    await new DbRepo(db).createUser({ id: 'tu1', email: 't@x.com', name: 'T', passwordHash: 'h', role: 'user' });
    const p = new PlatformRepo(db);

    const { tools, inventory } = await buildSkillTools(p, 'tu1', 'code');
    assert.ok(tools.save_skill, 'save_skill tool must be present even with zero skills');
    assert.ok(inventory.includes('save_skill'), 'inventory should mention save_skill');
  });

  it('calling save_skill creates the skill (slug "weekly-report") and returns text containing "weekly-report"', async () => {
    const db = createTestDatabase();
    await new DbRepo(db).createUser({ id: 'tu1', email: 't@x.com', name: 'T', passwordHash: 'h', role: 'user' });
    const p = new PlatformRepo(db);

    const { tools } = await buildSkillTools(p, 'tu1', 'code');
    const result = await (tools.save_skill as any).execute(
      { name: 'Weekly Report', description: 'd', instructions: '1. x' },
      { toolCallId: 't', messages: [] } as any,
    );
    assert.ok(result.includes('weekly-report'), `expected "weekly-report" in "${result}"`);
    const skills = await p.listSkills('tu1');
    assert.equal(skills.length, 1, 'should have exactly 1 skill');
    assert.equal(skills[0].slug, 'weekly-report');
  });

  it('calling save_skill again with new instructions bumps the version and keeps one skill', async () => {
    const db = createTestDatabase();
    await new DbRepo(db).createUser({ id: 'tu1', email: 't@x.com', name: 'T', passwordHash: 'h', role: 'user' });
    const p = new PlatformRepo(db);

    // First save
    const { tools } = await buildSkillTools(p, 'tu1', 'code');
    await (tools.save_skill as any).execute(
      { name: 'Weekly Report', description: 'd', instructions: 'first' },
      { toolCallId: 't1', messages: [] } as any,
    );

    // Second save (same name)
    const result2 = await (tools.save_skill as any).execute(
      { name: 'Weekly Report', description: 'd', instructions: 'second updated' },
      { toolCallId: 't2', messages: [] } as any,
    );
    assert.ok(result2.includes('version 2'), `expected version bump in "${result2}"`);

    const skills = await p.listSkills('tu1');
    assert.equal(skills.length, 1, 'should still have exactly 1 skill');
    assert.equal(skills[0].instructions, 'second updated');
    assert.equal(skills[0].version, 2);
  });

  it('blank (whitespace) instructions return text starting with "Error:"', async () => {
    const db = createTestDatabase();
    await new DbRepo(db).createUser({ id: 'tu1', email: 't@x.com', name: 'T', passwordHash: 'h', role: 'user' });
    const p = new PlatformRepo(db);

    const { tools } = await buildSkillTools(p, 'tu1', 'code');

    // Whitespace-only instructions
    const r1 = await (tools.save_skill as any).execute(
      { name: 'x', description: 'y', instructions: '   ' },
      { toolCallId: 't', messages: [] } as any,
    );
    assert.ok(r1.startsWith('Error:'), `expected Error:, got "${r1}"`);

    // Empty name
    const r2 = await (tools.save_skill as any).execute(
      { name: '', description: 'y', instructions: 'step 1' },
      { toolCallId: 't', messages: [] } as any,
    );
    assert.ok(r2.startsWith('Error:'), `expected Error:, got "${r2}"`);

    // Verify nothing was created
    const skills = await p.listSkills('tu1');
    assert.equal(skills.length, 0, 'no skill should be saved for blank inputs');
  });

  it('after saving, a fresh buildSkillTools includes load_skill and its inventory lists "weekly-report"', async () => {
    const db = createTestDatabase();
    await new DbRepo(db).createUser({ id: 'tu1', email: 't@x.com', name: 'T', passwordHash: 'h', role: 'user' });
    const p = new PlatformRepo(db);

    // Save a skill
    let { tools } = await buildSkillTools(p, 'tu1', 'code');
    await (tools.save_skill as any).execute(
      { name: 'Weekly Report', description: 'weekly report gen', instructions: '1. generate 2. email' },
      { toolCallId: 't', messages: [] } as any,
    );

    // Fresh build
    const { tools: toolsFresh, inventory: inv } = await buildSkillTools(p, 'tu1', 'code');
    assert.ok(toolsFresh.load_skill, 'load_skill must be present after a skill exists');
    assert.ok(inv.includes('weekly-report'), `inventory should list "weekly-report":\n${inv}`);

    // Verify load_skill works
    const loadResult = await (toolsFresh.load_skill as any).execute(
      { slug: 'weekly-report' },
      { toolCallId: 't2', messages: [] } as any,
    );
    assert.ok(loadResult.includes('# Skill: Weekly Report'), `load_skill should return skill content`);
  });
});
