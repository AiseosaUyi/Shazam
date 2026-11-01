import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { WaitlistRepo } from '@/lib/db/waitlist-repo';
import { googleAccessFor } from '@/lib/google/access';

describe('early-access waitlist', () => {
  it('is idempotent and case-insensitive on email', async () => {
    createTestRepo();
    const w = new WaitlistRepo();
    const a = await w.join({ email: 'Ada@Example.com', source: 'web' });
    const b = await w.join({ email: 'ada@example.com', name: 'Ada', useCase: 'Coding' });
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(b.entry.id, a.entry.id);
    assert.equal(b.entry.name, 'Ada');
    assert.equal((await w.list()).length, 1);
  });

  it('gates Google connect: none → pending → approved after invite', async () => {
    createTestRepo();
    delete process.env.GOOGLE_OAUTH_PUBLIC;
    const user = { email: 'grace@example.com', role: 'user' as const };
    assert.equal(await googleAccessFor(user), 'none');
    const { entry } = await new WaitlistRepo().join({ email: user.email });
    assert.equal(await googleAccessFor(user), 'pending');
    assert.equal(await new WaitlistRepo().setStatus(entry.id, 'invited'), true);
    assert.equal(await googleAccessFor(user), 'approved');
  });

  it('admins are always approved, and GOOGLE_OAUTH_PUBLIC opens it to everyone', async () => {
    createTestRepo();
    assert.equal(await googleAccessFor({ email: 'boss@example.com', role: 'admin' }), 'approved');
    process.env.GOOGLE_OAUTH_PUBLIC = 'true';
    try {
      assert.equal(await googleAccessFor({ email: 'anyone@example.com', role: 'user' }), 'open');
    } finally {
      delete process.env.GOOGLE_OAUTH_PUBLIC;
    }
  });
});

describe('rate limiting', () => {
  it('blocks after maxHits within the window (signature: key, windowSeconds, maxHits)', async () => {
    const repo = createTestRepo();
    for (let i = 0; i < 5; i++) assert.equal((await repo.checkRateLimit('t:ip', 60, 5)).allowed, true);
    assert.equal((await repo.checkRateLimit('t:ip', 60, 5)).allowed, false);
  });
});
