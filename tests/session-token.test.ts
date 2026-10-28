import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSignedSessionToken, verifySignedSessionToken } from '../src/lib/crypto/session-token';
import { getCurrentUser } from '../src/lib/auth/session';
import { createTestRepo } from '../src/lib/db/test-sqlite';
import { NextRequest } from 'next/server';

describe('Signed Session Token & Resilience Tests', () => {
  it('creates and verifies a valid HMAC-SHA256 session token', async () => {
    const user = { id: 'usr_test_123', email: 'tester@shazam.ai', role: 'user' };
    const token = await createSignedSessionToken(user, 3600);

    assert.ok(token.includes('.'), 'token must have payload.signature format');

    const claim = await verifySignedSessionToken(token);
    assert.ok(claim !== null, 'claim should be verified');
    assert.strictEqual(claim?.u, user.id);
    assert.strictEqual(claim?.e, user.email);
    assert.strictEqual(claim?.r, user.role);
    assert.ok(claim!.exp > Math.floor(Date.now() / 1000));
  });

  it('rejects tampered or forged tokens', async () => {
    const user = { id: 'usr_test_123', email: 'tester@shazam.ai', role: 'user' };
    const token = await createSignedSessionToken(user, 3600);
    const [payload, sig] = token.split('.');

    // Tamper with payload
    const tamperedToken = `${payload}x.${sig}`;
    const claim = await verifySignedSessionToken(tamperedToken);
    assert.strictEqual(claim, null, 'tampered token should be rejected');

    // Tamper with signature
    const tamperedSig = `${payload}.${sig.slice(0, -2)}aa`;
    const claim2 = await verifySignedSessionToken(tamperedSig);
    assert.strictEqual(claim2, null, 'invalid signature should be rejected');
  });

  it('rejects expired tokens', async () => {
    const user = { id: 'usr_test_123', email: 'tester@shazam.ai', role: 'user' };
    // Token that expired 10 seconds ago
    const token = await createSignedSessionToken(user, -10);
    const claim = await verifySignedSessionToken(token);
    assert.strictEqual(claim, null, 'expired token should be rejected');
  });

  it('authenticates user via getCurrentUser even without prior DB session row (stateless fallback)', async () => {
    const repo = createTestRepo();
    const user = { id: 'usr_stateless_01', email: 'stateless@shazam.ai', role: 'user' };
    const token = await createSignedSessionToken(user, 3600);

    const req = new NextRequest('http://localhost:3000/api/v1/auth/me', {
      headers: {
        cookie: `shazam_session=${token}`,
      },
    });

    const authenticatedUser = await getCurrentUser(req, repo);
    assert.ok(authenticatedUser !== null, 'user should be authenticated via signed token fallback');
    assert.strictEqual(authenticatedUser?.id, user.id);
    assert.strictEqual(authenticatedUser?.email, user.email);
  });
});
