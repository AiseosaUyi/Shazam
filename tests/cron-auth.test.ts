import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isCronAuthorized } from '../src/lib/auth/cron-auth';

describe('cron-auth constant-time check', () => {
  const env = process.env as Record<string, string | undefined>;

  function withCronSecret(val: string | undefined) {
    if (val === undefined) {
      delete env.CRON_SECRET;
    } else {
      env.CRON_SECRET = val;
    }
  }

  function makeAuthReq(token: string | null): Request {
    const headers: Record<string, string> = {};
    if (token !== null) headers['authorization'] = `Bearer ${token}`;
    return new Request('http://localhost/api/cron/jobs', { headers });
  }

  it('returns false when CRON_SECRET is unset', () => {
    const saved = env.CRON_SECRET;
    try {
      delete env.CRON_SECRET;
      assert.strictEqual(isCronAuthorized(makeAuthReq('deadbeef')), false);
    } finally {
      if (saved !== undefined) env.CRON_SECRET = saved;
      else delete env.CRON_SECRET;
    }
  });

  it('returns false when CRON_SECRET is empty string', () => {
    const saved = env.CRON_SECRET;
    try {
      env.CRON_SECRET = '';
      assert.strictEqual(isCronAuthorized(makeAuthReq('deadbeef')), false);
    } finally {
      if (saved !== undefined) env.CRON_SECRET = saved;
      else delete env.CRON_SECRET;
    }
  });

  it('returns false when authorization header is missing', () => {
    withCronSecret('my-secret');
    assert.strictEqual(isCronAuthorized(makeAuthReq(null)), false);
  });

  it('returns true for the correct Bearer token', () => {
    withCronSecret('my-secret');
    assert.strictEqual(
      isCronAuthorized(new Request('http://localhost/api/cron/jobs', {
        headers: { authorization: 'Bearer my-secret' },
      })),
      true
    );
  });

  it('returns false for a wrong token', () => {
    withCronSecret('my-secret');
    assert.strictEqual(
      isCronAuthorized(new Request('http://localhost/api/cron/jobs', {
        headers: { authorization: 'Bearer wrong-token' },
      })),
      false
    );
  });

  it('returns false for a different-length token', () => {
    withCronSecret('my-secret');
    assert.strictEqual(
      isCronAuthorized(new Request('http://localhost/api/cron/jobs', {
        headers: { authorization: 'Bearer my-secret-extra-padding' },
      })),
      false
    );
  });

  it('returns false when no Bearer prefix is used (plaintext)', () => {
    withCronSecret('my-secret');
    assert.strictEqual(
      isCronAuthorized(new Request('http://localhost/api/cron/jobs', {
        headers: { authorization: 'my-secret' },
      })),
      false
    );
  });

  it('returns false for empty auth header value', () => {
    withCronSecret('my-secret');
    assert.strictEqual(
      isCronAuthorized(new Request('http://localhost/api/cron/jobs', {
        headers: { authorization: '' },
      })),
      false
    );
  });
});
