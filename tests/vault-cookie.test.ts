import { describe, it } from 'node:test';
import assert from 'node:assert';
import { setVaultCookieOnResponse, syncVaultFromCookie, VAULT_COOKIE_NAME } from '../src/lib/crypto/vault-cookie';
import { createTestRepo } from '../src/lib/db/test-sqlite';
import { NextRequest, NextResponse } from 'next/server';

describe('Vault Cookie Cross-Container Durability Tests', () => {
  it('serializes and hydrates credentials across independent repo instances via cookie', async () => {
    // 1. Container A: User connects a key
    const repoA = createTestRepo();
    const userId = 'usr_qa_sync_01';
    await repoA.createUser({
      id: userId,
      email: `${userId}@shazam.ai`,
      name: 'QA Sync User',
      passwordHash: 'dummy-hash',
      role: 'user',
    });

    await repoA.setCredential({
      id: `${userId}:google`,
      userId,
      providerId: 'google',
      encryptedKey: 'mock-encrypted-key-12345',
      keyHint: 'AIz...1234',
      status: 'valid',
    });

    const response = NextResponse.json({ success: true });
    await setVaultCookieOnResponse(response, userId, repoA);

    const vaultCookie = response.cookies.get(VAULT_COOKIE_NAME)?.value;
    assert.ok(vaultCookie, 'shazam_vault cookie must be set');

    // 2. Container B: Fresh repo instance with empty database
    const repoB = createTestRepo();
    const credsBefore = await repoB.getCredentials(userId);
    assert.strictEqual(credsBefore.length, 0, 'Container B starts with 0 credentials');

    // 3. Request hits Container B with shazam_vault cookie
    const req = new NextRequest('http://localhost:3000/api/v1/tasks', {
      headers: {
        cookie: `${VAULT_COOKIE_NAME}=${vaultCookie}`,
      },
    });

    await syncVaultFromCookie(req, userId, repoB);

    // 4. Container B should now have the credential hydrated
    const credsAfter = await repoB.getCredentials(userId);
    assert.strictEqual(credsAfter.length, 1, 'Container B must have hydrated 1 credential');
    assert.strictEqual(credsAfter[0].providerId, 'google');
    assert.strictEqual(credsAfter[0].keyHint, 'AIz...1234');
    assert.strictEqual(credsAfter[0].status, 'valid');
  });
});
