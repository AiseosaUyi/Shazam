import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { LibsqlDatabase } from '@/lib/db/libsql';
import { DbRepo } from '@/lib/db/repo';

describe('Turso / libSQL persistent database adapter', () => {
  it('migrates once and round-trips repo data across fresh connections', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-libsql-')), 'db.sqlite');
    const url = `file:${file}`;

    const repo1 = new DbRepo(new LibsqlDatabase(createClient({ url, intMode: 'number' })));
    await repo1.createUser({ id: 'u1', email: 'A@Example.com', name: 'A', passwordHash: 'h', role: 'user' });

    // A second, independent connection (like a different serverless instance) sees the data
    // and does not re-run migrations (ALTER TABLE would fail if it did).
    const repo2 = new DbRepo(new LibsqlDatabase(createClient({ url, intMode: 'number' })));
    const user = await repo2.getUserByEmail('a@example.com');
    assert.ok(user);
    assert.equal(user.id, 'u1');
    await repo2.createMcpServer('u1', { id: 'm1', name: 'Test', url: 'https://x.test/mcp', toolsCache: [{ name: 't' }] });
    const servers = await repo1.getMcpServers('u1');
    assert.equal(servers[0].tools[0].name, 't');
  });

  it('creates the client lazily (production path) and the adapter module stays synchronous', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-libsql-')), 'db.sqlite');
    let created = 0;
    const db = new LibsqlDatabase(async () => {
      created++;
      return createClient({ url: `file:${file}`, intMode: 'number' });
    });
    assert.equal(created, 0, 'no client before the first query');
    const repo = new DbRepo(db);
    await repo.createUser({ id: 'u2', email: 'b@example.com', name: 'B', passwordHash: 'h', role: 'user' });
    assert.equal((await repo.getUserByEmail('b@example.com'))?.id, 'u2');
    assert.equal(created, 1, 'client is created once and reused');

    // Guard against the prod crash: the module must not statically import @libsql/client.
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/db/libsql.ts'), 'utf8');
    assert.doesNotMatch(src, /^import (?!type )[^;]*from '@libsql\/client'/m);
  });
});
