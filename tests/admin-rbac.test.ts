import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { requireAdmin, requireUser, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { hashSessionToken } from '@/lib/crypto/auth';

describe('Admin RBAC Security Tests', () => {
  it('throws Forbidden error when non-admin user attempts admin access', async () => {
    const repo = createTestRepo();
    const token = 'member-session-token-1234567890';
    const tokenHash = await hashSessionToken(token);

    // Create member user and session
    await repo.createUser({
      id: 'member_user_id',
      email: 'member@shazam.ai',
      name: 'Member User',
      passwordHash: 'hash',
      role: 'user',
    });

    await repo.createSession(
      tokenHash,
      'member_user_id',
      new Date(Date.now() + 3600000).toISOString()
    );

    const req = new NextRequest('http://localhost:3000/api/v1/admin/overrides', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });

    // requireUser should succeed
    const user = await requireUser(req, repo);
    assert.strictEqual(user.role, 'user');

    // requireAdmin must reject
    await assert.rejects(
      async () => {
        await requireAdmin(req, repo);
      },
      /Forbidden: Admin role required/
    );
  });

  it('allows access when user has admin role', async () => {
    const repo = createTestRepo();
    const token = 'admin-session-token-1234567890';
    const tokenHash = await hashSessionToken(token);

    // Create admin user and session
    await repo.createUser({
      id: 'admin_user_id',
      email: 'admin@shazam.ai',
      name: 'Admin User',
      passwordHash: 'hash',
      role: 'admin',
    });

    await repo.createSession(
      tokenHash,
      'admin_user_id',
      new Date(Date.now() + 3600000).toISOString()
    );

    const req = new NextRequest('http://localhost:3000/api/v1/admin/overrides', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });

    const admin = await requireAdmin(req, repo);
    assert.strictEqual(admin.role, 'admin');
    assert.strictEqual(admin.id, 'admin_user_id');
  });
});
