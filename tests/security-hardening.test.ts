import { describe, it } from 'node:test';
import assert from 'node:assert';
import { NextRequest } from 'next/server';
import { createSignedSessionToken } from '../src/lib/crypto/session-token';
import { hashSessionToken } from '../src/lib/crypto/auth';
import { getCurrentUser, verifyCsrfOrigin } from '../src/lib/auth/session';
import { classifyTask } from '../src/lib/routing/classifier';
import { createTestRepo } from '../src/lib/db/test-sqlite';

function reqWithCookie(token: string) {
  return new NextRequest('http://localhost:3000/api/v1/tasks', { headers: { cookie: `shazam_session=${token}` } });
}

async function seedUser(repo: ReturnType<typeof createTestRepo>, id: string, email: string) {
  await repo.createUser({ id, email, name: email.split('@')[0], passwordHash: 'x', role: 'user' });
}

describe('security hardening', () => {
  it('a logged-out session cannot be revived by its still-valid signature', async () => {
    const repo = createTestRepo();
    await seedUser(repo, 'usr_logout', 'logout@shazam.ai');
    const token = await createSignedSessionToken({ id: 'usr_logout', email: 'logout@shazam.ai', role: 'user' }, 3600);
    const hash = await hashSessionToken(token);
    await repo.createSession(hash, 'usr_logout', new Date(Date.now() + 3600_000).toISOString());

    assert.ok(await getCurrentUser(reqWithCookie(token), repo), 'live session works');
    await repo.deleteSession(hash);
    assert.strictEqual(await getCurrentUser(reqWithCookie(token), repo), null, 'revoked session must stay dead');
  });

  it('a suspended account is rejected even with a valid signed token', async () => {
    const repo = createTestRepo();
    await seedUser(repo, 'usr_susp', 'susp@shazam.ai');
    await (repo as any).db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").bind('usr_susp').run();
    const token = await createSignedSessionToken({ id: 'usr_susp', email: 'susp@shazam.ai', role: 'user' }, 3600);
    const user = await getCurrentUser(reqWithCookie(token), repo);
    assert.strictEqual(user, null);
  });

  it('CSRF check rejects arbitrary *.workers.dev origins', () => {
    const evil = new NextRequest('https://app.example.com/api/v1/tasks', {
      method: 'POST',
      headers: { origin: 'https://evil.attacker.workers.dev', host: 'app.example.com' },
    });
    assert.strictEqual(verifyCsrfOrigin(evil), false);
    const same = new NextRequest('https://app.example.com/api/v1/tasks', {
      method: 'POST',
      headers: { origin: 'https://app.example.com', host: 'app.example.com' },
    });
    assert.strictEqual(verifyCsrfOrigin(same), true);
  });

  it('production refuses to sign sessions or encrypt keys without configured secrets', async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { n: env.NODE_ENV, s: env.SESSION_SECRET, k: env.SHAZAM_ENCRYPTION_KEY };
    try {
      env.NODE_ENV = 'production';
      delete env.SESSION_SECRET;
      delete env.SHAZAM_ENCRYPTION_KEY;
      await assert.rejects(() => createSignedSessionToken({ id: 'u', email: 'a@b.co', role: 'user' }, 60), /SESSION_SECRET/);
      const { encryptSecret } = await import('../src/lib/crypto/vault');
      await assert.rejects(() => encryptSecret('sk-test'), /SHAZAM_ENCRYPTION_KEY/);
    } finally {
      env.NODE_ENV = saved.n;
      if (saved.s !== undefined) env.SESSION_SECRET = saved.s;
      if (saved.k !== undefined) env.SHAZAM_ENCRYPTION_KEY = saved.k;
    }
  });
});

describe('classifier substring bugs', () => {
  it('"democracy" is not an OCR request', () => {
    assert.notStrictEqual(classifyTask('Explain how democracy works').taskClass, 'vision');
    assert.strictEqual(classifyTask('Run OCR on this scan').taskClass, 'vision');
  });
  it('"dysfunction" is not a coding request, "function" still is', () => {
    assert.notStrictEqual(classifyTask('Why does erectile dysfunction happen with age').taskClass, 'coding');
    assert.strictEqual(classifyTask('Write a function that parses dates').taskClass, 'coding');
  });
  it('transcription outputs text, not audio', () => {
    const spec = classifyTask('Please transcribe this meeting');
    assert.strictEqual(spec.taskClass, 'audio');
    assert.strictEqual(spec.outputModality, 'text');
    assert.strictEqual(classifyTask('Write a voiceover script read aloud').outputModality, 'audio');
  });
});
