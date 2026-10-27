import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createTestRepo } from '@/lib/db/test-sqlite';

describe('Tenant Isolation Tests', () => {
  const userA = 'user_alice_123';
  const userB = 'user_bob_456';

  async function seedUsers(repo: any) {
    await repo.createUser({
      id: userA,
      email: 'alice@example.com',
      name: 'Alice',
      passwordHash: 'dummy',
      role: 'user',
    });
    await repo.createUser({
      id: userB,
      email: 'bob@example.com',
      name: 'Bob',
      passwordHash: 'dummy',
      role: 'user',
    });
  }

  it('prevents User B from reading or modifying User A credentials', async () => {
    const repo = createTestRepo();
    await seedUsers(repo);
    await repo.setCredential({
      id: `${userA}:openai`,
      userId: userA,
      providerId: 'openai',
      encryptedKey: 'secret_payload_alice',
      keyHint: 'sk-...aaaa',
      status: 'valid',
    });

    // Bob attempts to query credentials
    const bobCreds = await repo.getCredentials(userB);
    assert.strictEqual(bobCreds.length, 0);

    const bobSpecific = await repo.getCredential(userB, 'openai');
    assert.strictEqual(bobSpecific, null);

    // Bob attempts to delete Alice's credential
    const deleted = await repo.deleteCredential(userB, 'openai');
    assert.strictEqual(deleted, false);

    // Alice's credential is still intact
    const aliceCred = await repo.getCredential(userA, 'openai');
    assert.ok(aliceCred);
    assert.strictEqual(aliceCred.encryptedKey, 'secret_payload_alice');
  });

  it('prevents User B from reading User A tasks or conversations', async () => {
    const repo = createTestRepo();
    await seedUsers(repo);
    const taskId = 'task_alice_001';
    await repo.createTask({
      id: taskId,
      userId: userA,
      status: 'succeeded',
      taskClass: 'writing',
      costPolicy: 'balanced',
      prompt: 'Confidential Alice prompt',
      response: 'Confidential Alice output',
      costUSD: 0.01,
      costKind: 'estimated',
      createdAt: new Date().toISOString(),
    });

    // Bob tries to read Alice's task
    const bobTask = await repo.getTask(userB, taskId);
    assert.strictEqual(bobTask, null);

    const bobTaskList = await repo.listTasks(userB);
    assert.strictEqual(bobTaskList.length, 0);

    // Alice can read her own task
    const aliceTask = await repo.getTask(userA, taskId);
    assert.ok(aliceTask);
    assert.strictEqual(aliceTask.prompt, 'Confidential Alice prompt');
  });

  it('prevents User B from accessing or overwriting User A workspace files', async () => {
    const repo = createTestRepo();
    await seedUsers(repo);
    const filePath = 'secrets/architecture.md';
    await repo.putWorkspaceFile(userA, filePath, '# Alice Secret Architecture');

    // Bob queries the workspace file
    const bobFile = await repo.getWorkspaceFile(userB, filePath);
    assert.strictEqual(bobFile, null);

    const bobFiles = await repo.getWorkspaceFiles(userB);
    assert.strictEqual(bobFiles.length, 0);

    // Bob tries to delete the file under his tenant
    const deleted = await repo.deleteWorkspaceFile(userB, filePath);
    assert.strictEqual(deleted, false);

    // Alice's file is untouched
    const aliceFile = await repo.getWorkspaceFile(userA, filePath);
    assert.ok(aliceFile);
    assert.strictEqual(aliceFile.content, '# Alice Secret Architecture');
  });
});
