import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestRepo } from '@/lib/db/test-sqlite';

describe('Project Workspace & Isolation Tests', () => {
  const userA = 'user_alice_proj';
  const userB = 'user_bob_proj';

  async function seedUsers(repo: any) {
    await repo.createUser({
      id: userA,
      email: 'alice.proj@example.com',
      name: 'Alice',
      passwordHash: 'dummy',
      role: 'user',
    });
    await repo.createUser({
      id: userB,
      email: 'bob.proj@example.com',
      name: 'Bob',
      passwordHash: 'dummy',
      role: 'user',
    });
  }

  it('isolates projects between tenants', async () => {
    const repo = createTestRepo();
    await seedUsers(repo);

    await repo.createProject(userA, {
      id: 'proj_alice_1',
      name: 'Alice Project',
      description: 'Private project',
    });

    // Alice sees her project
    const aliceProjects = await repo.getProjects(userA);
    assert.strictEqual(aliceProjects.length, 1);
    assert.strictEqual(aliceProjects[0].name, 'Alice Project');

    // Bob cannot see Alice's project
    const bobProjects = await repo.getProjects(userB);
    assert.strictEqual(bobProjects.length, 0);

    const bobSpecific = await repo.getProject(userB, 'proj_alice_1');
    assert.strictEqual(bobSpecific, null);

    // Bob cannot delete Alice's project
    const deleted = await repo.deleteProject(userB, 'proj_alice_1');
    assert.strictEqual(deleted, false);

    // Alice's project is still present
    const aliceSpecific = await repo.getProject(userA, 'proj_alice_1');
    assert.notStrictEqual(aliceSpecific, null);
  });

  it('scopes files to specific projects and supports bulk ingestion', async () => {
    const repo = createTestRepo();
    await seedUsers(repo);

    await repo.createProject(userA, { id: 'proj_alpha', name: 'Alpha' });
    await repo.createProject(userA, { id: 'proj_beta', name: 'Beta' });

    // Put files into Alpha
    await repo.putProjectFile(userA, 'proj_alpha', 'src/index.ts', 'console.log("alpha");');
    // Bulk put files into Beta
    await repo.putProjectFilesBulk(userA, 'proj_beta', [
      { path: 'main.py', content: 'print("beta")' },
      { path: 'README.md', content: '# Beta Project' },
    ]);

    const alphaFiles = await repo.getProjectFiles(userA, 'proj_alpha');
    assert.strictEqual(alphaFiles.length, 1);
    assert.strictEqual(alphaFiles[0].path, 'src/index.ts');

    const betaFiles = await repo.getProjectFiles(userA, 'proj_beta');
    assert.strictEqual(betaFiles.length, 2);

    // Deleting project cleans up its files
    await repo.deleteProject(userA, 'proj_beta');
    const betaFilesAfter = await repo.getProjectFiles(userA, 'proj_beta');
    assert.strictEqual(betaFilesAfter.length, 0);

    // Alpha files untouched
    const alphaFilesStillThere = await repo.getProjectFiles(userA, 'proj_alpha');
    assert.strictEqual(alphaFilesStillThere.length, 1);
  });

  it('strictly isolates conversations by project (Antigravity standard)', async () => {
    const repo = createTestRepo();
    await seedUsers(repo);

    await repo.createProject(userA, { id: 'proj_zoqo', name: 'Zoqo' });
    await repo.createProject(userA, { id: 'proj_shazam', name: 'Shazam' });

    // Create conversation in Zoqo
    const convZoqo = await repo.createConversation(userA, 'conv_z1', 'Setup Local LLM', 'proj_zoqo');
    assert.strictEqual(convZoqo.projectId, 'proj_zoqo');

    // Create conversation in Shazam
    const convShazam = await repo.createConversation(userA, 'conv_s1', 'Antigravity MVP', 'proj_shazam');
    assert.strictEqual(convShazam.projectId, 'proj_shazam');

    // Create unassigned conversation
    await repo.createConversation(userA, 'conv_unassigned', 'Quick Scratchpad', null);

    // List conversations specifically for Zoqo: ONLY conv_z1 should return
    const zoqoConvs = await repo.getConversations(userA, 'proj_zoqo');
    assert.strictEqual(zoqoConvs.length, 1);
    assert.strictEqual(zoqoConvs[0].id, 'conv_z1');
    assert.strictEqual(zoqoConvs[0].title, 'Setup Local LLM');

    // List conversations specifically for Shazam: ONLY conv_s1 should return
    const shazamConvs = await repo.getConversations(userA, 'proj_shazam');
    assert.strictEqual(shazamConvs.length, 1);
    assert.strictEqual(shazamConvs[0].id, 'conv_s1');
    assert.strictEqual(shazamConvs[0].title, 'Antigravity MVP');

    // List unassigned conversations (null project_id)
    const unassignedConvs = await repo.getConversations(userA, null);
    assert.strictEqual(unassignedConvs.length, 1);
    assert.strictEqual(unassignedConvs[0].id, 'conv_unassigned');

    // Cross-tenant check: userB cannot see userA's conversations even if querying userA's projectId
    const bobZoqoConvs = await repo.getConversations(userB, 'proj_zoqo');
    assert.strictEqual(bobZoqoConvs.length, 0);

    // Deleting Zoqo cascades to delete its conversations
    await repo.deleteProject(userA, 'proj_zoqo');
    const zoqoConvsAfter = await repo.getConversations(userA, 'proj_zoqo');
    assert.strictEqual(zoqoConvsAfter.length, 0);

    // Shazam conversation still remains intact
    const shazamConvsAfter = await repo.getConversations(userA, 'proj_shazam');
    assert.strictEqual(shazamConvsAfter.length, 1);
  });
});
