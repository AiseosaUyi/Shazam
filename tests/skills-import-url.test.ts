import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { normalizeSkillUrl, fetchSkillMarkdown, ALLOWED_HOSTS } from '@/lib/skills/import-url';

test('normalizeSkillUrl: blob → raw conversion', () => {
  const result = normalizeSkillUrl(
    'https://github.com/owner/repo/blob/main/path/SKILL.md',
  );
  assert.equal(result, 'https://raw.githubusercontent.com/owner/repo/main/path/SKILL.md');
});

test('normalizeSkillUrl: tree → raw + /SKILL.md conversion (no trailing dir)', () => {
  const result = normalizeSkillUrl(
    'https://github.com/owner/repo/tree/main/dir',
  );
  assert.equal(result, 'https://raw.githubusercontent.com/owner/repo/main/dir/SKILL.md');
});

test('normalizeSkillUrl: tree → raw + /SKILL.md conversion (empty dir)', () => {
  const result = normalizeSkillUrl(
    'https://github.com/owner/repo/tree/main',
  );
  assert.equal(result, 'https://raw.githubusercontent.com/owner/repo/main/SKILL.md');
});

test('normalizeSkillUrl: raw.githubusercontent.com kept as-is', () => {
  const result = normalizeSkillUrl(
    'https://raw.githubusercontent.com/owner/repo/main/SKILL.md',
  );
  assert.equal(result, 'https://raw.githubusercontent.com/owner/repo/main/SKILL.md');
});

test('normalizeSkillUrl: gist.githubusercontent.com kept as-is', () => {
  const result = normalizeSkillUrl(
    'https://gist.githubusercontent.com/owner/file.md',
  );
  assert.equal(result, 'https://gist.githubusercontent.com/owner/file.md');
});

test('normalizeSkillUrl: drops hash', () => {
  const result = normalizeSkillUrl(
    'https://github.com/owner/repo/blob/main/SKILL.md#section',
  );
  assert.ok(!result.includes('#'));
  assert.equal(result, 'https://raw.githubusercontent.com/owner/repo/main/SKILL.md');
});

test('normalizeSkillUrl: rejects http://', () => {
  assert.throws(() => {
    normalizeSkillUrl('http://github.com/owner/repo/blob/main/SKILL.md');
  }, /Only GitHub links/);
});

test('normalizeSkillUrl: rejects evil.com', () => {
  assert.throws(() => {
    normalizeSkillUrl('https://evil.com/x.md');
  }, /Only GitHub links/);
});

test('normalizeSkillUrl: rejects subdomain-attack github.com.evil.com', () => {
  assert.throws(() => {
    normalizeSkillUrl(
      'https://github.com.evil.com/a/b/blob/main/SKILL.md',
    );
  }, /Only GitHub links/);
});

test('normalizeSkillUrl: rejects username:password@raw.githubusercontent.com', () => {
  assert.throws(() => {
    normalizeSkillUrl(
      'https://user:pw@raw.githubusercontent.com/a/b/main/SKILL.md',
    );
  }, /Only GitHub links/);
});

test('normalizeSkillUrl: rejects explicit port :8443', () => {
  assert.throws(() => {
    normalizeSkillUrl(
      'https://raw.githubusercontent.com:8443/a/b/main/SKILL.md',
    );
  }, /Only GitHub links/);
});

test('normalizeSkillUrl: rejects .txt file', () => {
  assert.throws(() => {
    normalizeSkillUrl(
      'https://github.com/owner/repo/blob/main/file.txt',
    );
  }, /\.md/);
});

test('normalizeSkillUrl: rejects ".." segments', () => {
  assert.throws(() => {
    normalizeSkillUrl(
      'https://github.com/owner/repo/blob/main/../SKILL.md',
    );
  }, /Invalid GitHub link/);
});

test('normalizeSkillUrl: rejects garbage string', () => {
  assert.throws(() => {
    normalizeSkillUrl('not-a-url');
  }, /Enter a valid URL/);
});

test('fetchSkillMarkdown: returns text on 200', async () => {
  const fakeFetchImpl = async (url: string, init: RequestInit) => {
    assert.deepStrictEqual(init.redirect, 'error');
    return new Response('hello', { status: 200 });
  };
  // Use a URL that normalizes to an allowed host for testing.
  const result = await fetchSkillMarkdown(
    'https://raw.githubusercontent.com/a/b/main/SKILL.md',
    fakeFetchImpl as typeof fetch,
  );
  assert.equal(result, 'hello');
});

test('fetchSkillMarkdown: throws on 404', async () => {
  const fakeFetchImpl = async (): Promise<Response> => {
    return new Response('', { status: 404 });
  };
  await assert.rejects(
    fetchSkillMarkdown('https://raw.githubusercontent.com/a/b/main/SKILL.md', fakeFetchImpl as typeof fetch),
    /Couldn't download the skill \(HTTP 404\)/,
  );
});

test('fetchSkillMarkdown: throws when content-length > 100_000', async () => {
  const fakeFetchImpl = async (): Promise<Response> => {
    return new Response('', {
      status: 200,
      headers: { 'Content-Length': '200000' },
    });
  };
  await assert.rejects(
    fetchSkillMarkdown('https://raw.githubusercontent.com/a/b/main/SKILL.md', fakeFetchImpl as typeof fetch),
    /too large/,
  );
});

test('fetchSkillMarkdown: throws when body length > 100_000', async () => {
  const big = 'x'.repeat(100_001);
  const fakeFetchImpl = async (): Promise<Response> => {
    return new Response(big, { status: 200 });
  };
  await assert.rejects(
    fetchSkillMarkdown('https://raw.githubusercontent.com/a/b/main/SKILL.md', fakeFetchImpl as typeof fetch),
    /too large/,
  );
});

test('fetchSkillMarkdown: passes redirect:error to fetchImpl', async () => {
  let receivedInit: any = null;
  const fakeFetchImpl = async (_url: string, init: any) => {
    receivedInit = init;
    return new Response('', { status: 200 });
  };
  await fetchSkillMarkdown(
    'https://raw.githubusercontent.com/a/b/main/SKILL.md',
    fakeFetchImpl as typeof fetch,
  );
  assert.strictEqual(receivedInit.redirect, 'error');
});
