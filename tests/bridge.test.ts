import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';
import { BridgeRepo, callDevice } from '@/lib/bridge/repo';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { guardPath, RISKY_COMMAND } = require('../desktop/bridge-core.js');

async function setup() {
  const db = createTestDatabase();
  await new DbRepo(db).createUser({ id: 'u1', email: 'a@x.com', name: 'A', passwordHash: 'h', role: 'user' });
  await new DbRepo(db).createUser({ id: 'u2', email: 'b@x.com', name: 'B', passwordHash: 'h', role: 'user' });
  return new BridgeRepo(db);
}

describe('Device bridge', () => {
  it('pairing codes work once and issue a token that authenticates until revoked', async () => {
    const repo = await setup();
    const { code } = await repo.createPairingCode('u1');
    const first = await repo.registerDevice(code.toLowerCase(), 'desktop', 'Mac', { workspaces: ['/tmp/x'] });
    assert.ok(first);
    assert.equal(await repo.registerDevice(code, 'desktop', 'Mac', {}), null, 'code is single-use');
    const dev = await repo.authenticate(first!.token);
    assert.equal(dev?.userId, 'u1');
    assert.equal((await repo.onlineDevice('u1', 'desktop'))?.id, first!.device.id);
    assert.equal(await repo.onlineDevice('u2', 'desktop'), null, 'other users never see it');
    await repo.revokeDevice('u1', first!.device.id);
    assert.equal(await repo.authenticate(first!.token), null);
  });

  it('round-trips a command exactly once between agent and device', async () => {
    const repo = await setup();
    const { code } = await repo.createPairingCode('u1');
    const { device } = (await repo.registerDevice(code, 'browser', 'Chrome', {}))!;

    // Simulated device: claim, then report a result.
    const deviceLoop = (async () => {
      for (let i = 0; i < 40; i++) {
        const cmds = await repo.claimForDevice(device.id);
        if (cmds.length) {
          assert.equal((await repo.claimForDevice(device.id)).length, 0, 'claimed commands are not re-delivered');
          await repo.complete(device.id, cmds[0].id, true, `opened ${cmds[0].payload.url}`);
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
    const out = await callDevice('u1', 'browser', 'open', { url: 'https://example.com' }, { repo, timeoutMs: 5000 });
    await deviceLoop;
    assert.deepEqual(out, { ok: true, result: 'opened https://example.com' });
  });

  it('reports an offline device honestly', async () => {
    const repo = await setup();
    await assert.rejects(callDevice('u1', 'desktop', 'exec', {}, { repo, timeoutMs: 500 }), /not connected/);
  });

  it('desktop guard keeps the agent inside allowed folders and away from secrets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shazam-ws-'));
    fs.writeFileSync(path.join(root, 'a.ts'), 'x');
    assert.ok(guardPath(path.join(root, 'a.ts'), [root]));
    assert.ok(guardPath(path.join(root, 'new/b.ts'), [root]));
    assert.throws(() => guardPath('/etc/passwd', [root]), /outside the folders/);
    assert.throws(() => guardPath(path.join(root, '../escape.txt'), [root]), /outside the folders/);
    assert.throws(() => guardPath(path.join(root, '.env'), [root]), /secret/);
    assert.ok(RISKY_COMMAND.test('git push origin main'));
    assert.ok(RISKY_COMMAND.test('rm -rf dist'));
    assert.ok(!RISKY_COMMAND.test('npm test'));
  });
});
