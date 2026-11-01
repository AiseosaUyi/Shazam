import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { createTestRepo } from '@/lib/db/test-sqlite';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { hashSessionToken } from '@/lib/crypto/auth';
import { BridgeRepo } from '@/lib/bridge/repo';
import { DeviceAuthRepo, normalizeUserCode } from '@/lib/bridge/device-auth';
import { ensureLocalFolder, offlineMessage } from '@/lib/bridge/folders';
import { POST as startRoute } from '@/app/api/v1/bridge/device/start/route';
import { POST as tokenRoute } from '@/app/api/v1/bridge/device/token/route';
import { GET as lookupRoute, POST as approveRoute } from '@/app/api/v1/bridge/device/approve/route';

const ORIGIN = 'http://localhost:3000';

async function setup() {
  const repo = createTestRepo(); // also points getDb() at this database for the routes
  const db = (repo as any).db;
  for (const [id, email] of [['u1', 'a@x.com'], ['u2', 'b@x.com']]) {
    await repo.createUser({ id, email, name: id, passwordHash: 'h', role: 'user' });
    await repo.createSession(await hashSessionToken(`session-token-for-${id}-0123456789`), id, new Date(Date.now() + 3_600_000).toISOString());
  }
  return { repo, db, bridge: new BridgeRepo(db), auth: new DeviceAuthRepo(db) };
}

function req(pathname: string, init: { method?: string; body?: unknown; user?: string; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:3000', 'x-forwarded-for': init.ip || '203.0.113.7', 'content-type': 'application/json' };
  if (init.user) headers.cookie = `${SESSION_COOKIE_NAME}=session-token-for-${init.user}-0123456789`;
  if (init.origin !== null && init.method === 'POST') headers.origin = init.origin ?? ORIGIN;
  return new NextRequest(`${ORIGIN}${pathname}`, { method: init.method || 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

async function startFlow(ip?: string) {
  const res = await startRoute(req('/api/v1/bridge/device/start', { method: 'POST', body: { kind: 'desktop', name: 'Ada’s Mac', capabilities: { platform: 'darwin' } }, origin: null, ip }));
  assert.equal(res.status, 200);
  return res.json();
}

const poll = async (device_code: string) => {
  const res = await tokenRoute(req('/api/v1/bridge/device/token', { method: 'POST', body: { device_code }, origin: null }));
  return { status: res.status, body: await res.json() };
};

describe('Bridge browser device authorization', () => {
  it('pairs a computer after the signed-in user approves, handing out the token exactly once', async () => {
    const { bridge } = await setup();
    const start = await startFlow();
    assert.match(start.user_code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.ok(start.device_code.startsWith('shz_dac_'));
    assert.equal(start.verification_uri_complete, `${ORIGIN}/connect?code=${start.user_code}`);

    assert.equal((await poll(start.device_code)).body.error, 'authorization_pending');

    const look = await lookupRoute(req(`/api/v1/bridge/device/approve?code=${start.user_code.toLowerCase()}`, { user: 'u1' }));
    assert.equal(look.status, 200);
    const { request } = await look.json();
    assert.equal(request.name, 'Ada’s Mac');
    assert.equal(request.platform, 'darwin');
    assert.equal(request.sameNetwork, true);

    const approve = await approveRoute(req('/api/v1/bridge/device/approve', { method: 'POST', user: 'u1', body: { user_code: start.user_code, approve: true } }));
    assert.equal(approve.status, 200);

    const got = await poll(start.device_code);
    assert.equal(got.status, 200);
    assert.equal(got.body.account.email, 'a@x.com');
    const device = await bridge.authenticate(got.body.token);
    assert.equal(device?.userId, 'u1', 'the device belongs to whoever approved it');
    assert.equal(device?.name, 'Ada’s Mac');

    assert.equal((await poll(start.device_code)).body.error, 'expired_token', 'the token is handed out once');
    const again = await approveRoute(req('/api/v1/bridge/device/approve', { method: 'POST', user: 'u2', body: { user_code: start.user_code, approve: true } }));
    assert.equal(again.status, 404, 'a used code cannot be approved again');
  });

  it('does not pair when the user denies', async () => {
    const { bridge } = await setup();
    const start = await startFlow();
    await approveRoute(req('/api/v1/bridge/device/approve', { method: 'POST', user: 'u1', body: { user_code: start.user_code, approve: false } }));
    assert.equal((await poll(start.device_code)).body.error, 'access_denied');
    assert.equal((await bridge.listDevices('u1')).length, 0);
  });

  it('requires a signed-in, same-origin request to approve', async () => {
    await setup();
    const start = await startFlow();
    const body = { user_code: start.user_code, approve: true };
    assert.equal((await approveRoute(req('/api/v1/bridge/device/approve', { method: 'POST', body }))).status, 401);
    assert.equal((await approveRoute(req('/api/v1/bridge/device/approve', { method: 'POST', user: 'u1', body, origin: null }))).status, 403);
    assert.equal((await approveRoute(req('/api/v1/bridge/device/approve', { method: 'POST', user: 'u1', body, origin: 'https://evil.example' }))).status, 403);
    assert.equal((await lookupRoute(req(`/api/v1/bridge/device/approve?code=${start.user_code}`))).status, 401);
    assert.equal((await poll(start.device_code)).body.error, 'authorization_pending', 'still unapproved');
  });

  it('rejects expired requests and wrong codes', async () => {
    const { db, auth } = await setup();
    const start = await startFlow();
    assert.equal((await lookupRoute(req('/api/v1/bridge/device/approve?code=ZZZZ-ZZZZ', { user: 'u1' }))).status, 404);
    await db.prepare('UPDATE bridge_device_auth SET expires_at = ?').bind(new Date(Date.now() - 1000).toISOString()).run();
    assert.equal(await auth.decide('u1', start.user_code, true), false);
    assert.equal((await poll(start.device_code)).body.error, 'expired_token');
    assert.equal((await poll('shz_dac_not-a-real-code')).body.error, 'expired_token');
  });

  it('tells a device that polls too fast to slow down', async () => {
    await setup();
    const start = await startFlow();
    assert.equal((await poll(start.device_code)).body.error, 'authorization_pending');
    assert.equal((await poll(start.device_code)).body.error, 'slow_down');
  });

  it('issues only one token when two polls race', async () => {
    const { auth, bridge } = await setup();
    const start = await startFlow();
    await auth.decide('u1', start.user_code, true);
    const results = await Promise.all([auth.poll(start.device_code, bridge), auth.poll(start.device_code, bridge)]);
    assert.equal(results.filter((r) => r.status === 'approved').length, 1);
    assert.equal((await bridge.listDevices('u1')).length, 1);
  });

  it('warns when the approver is on a different network than the computer', async () => {
    await setup();
    const start = await startFlow('198.51.100.1');
    const look = await lookupRoute(req(`/api/v1/bridge/device/approve?code=${start.user_code}`, { user: 'u1', ip: '203.0.113.99' }));
    assert.equal((await look.json()).request.sameNetwork, false);
  });

  it('rate limits starting requests per network', async () => {
    await setup();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await startRoute(req('/api/v1/bridge/device/start', { method: 'POST', body: { name: 'Mac' }, origin: null, ip: '192.0.2.50' }))).status;
    }
    assert.equal(last, 429);
  });

  it('normalizes user codes and keeps the old pairing-code flow working', async () => {
    const { bridge } = await setup();
    assert.equal(normalizeUserCode('abcd-efgh'), 'ABCDEFGH');
    assert.equal(normalizeUserCode(' ab cd ef gh '), 'ABCDEFGH');
    const { code } = await bridge.createPairingCode('u2');
    const out = await bridge.registerDevice(code, 'desktop', 'Old flow', {});
    assert.equal((await bridge.authenticate(out!.token))?.userId, 'u2');
  });
});

describe('Local folder tasks', () => {
  it('returns one actionable line with the connect link when the computer is offline', async () => {
    const { bridge } = await setup();
    await assert.rejects(ensureLocalFolder('u1', '/Users/ada/app', { repo: bridge }), (err: Error) => {
      assert.equal(err.message, offlineMessage('/Users/ada/app'));
      assert.match(err.message, /\/connect\b/);
      assert.doesNotMatch(err.message, /shazam-bridge|\n/);
      return true;
    });
  });

  async function onlineDevice(bridge: BridgeRepo, workspaces: string[]) {
    const { code } = await bridge.createPairingCode('u1');
    return (await bridge.registerDevice(code, 'desktop', 'Mac', { workspaces }))!.device;
  }

  /** Simulated computer: answers the first request_folder command with `answer`. */
  function answerFolderPrompt(bridge: BridgeRepo, deviceId: string, answer: (payload: any) => unknown) {
    return (async () => {
      for (let i = 0; i < 60; i++) {
        const cmds = await bridge.claimForDevice(deviceId);
        if (cmds.length) {
          assert.equal(cmds[0].command, 'request_folder');
          await bridge.complete(deviceId, cmds[0].id, true, answer(cmds[0].payload));
          return cmds[0].payload;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
  }

  it('uses an allowed folder without asking', async () => {
    const { bridge } = await setup();
    await onlineDevice(bridge, ['/Users/ada/projects']);
    const device = await ensureLocalFolder('u1', '/Users/ada/projects/app', { repo: bridge, timeoutMs: 500 });
    assert.equal(device.name, 'Mac');
  });

  it('asks on the computer for a new folder and continues once allowed', async () => {
    const { bridge } = await setup();
    const dev = await onlineDevice(bridge, []);
    const asked = answerFolderPrompt(bridge, dev.id, (p) => ({ allowed: true, folder: p.path, workspaces: [p.path] }));
    const device = await ensureLocalFolder('u1', '/Users/ada/new-app', { repo: bridge, timeoutMs: 5000 });
    assert.equal((await asked).path, '/Users/ada/new-app');
    assert.deepEqual(device.capabilities.workspaces, ['/Users/ada/new-app']);
  });

  it('stops with a clear message when the user declines', async () => {
    const { bridge } = await setup();
    const dev = await onlineDevice(bridge, []);
    const asked = answerFolderPrompt(bridge, dev.id, (p) => ({ allowed: false, folder: p.path }));
    await assert.rejects(ensureLocalFolder('u1', '/Users/ada/secret', { repo: bridge, timeoutMs: 5000 }), /didn't allow Arcwork to work in \/Users\/ada\/secret/);
    await asked;
  });
});

describe('Bridge client folder consent', () => {
  // Point the bridge config at a temp home so tests never touch the real ~/.shazam.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'arcwork-home-'));
  process.env.HOME = home;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = require('../desktop/bridge-core.js');
  const project = fs.mkdtempSync(path.join(home, 'project-'));

  it('refuses folders that are too broad or hold credentials', () => {
    assert.throws(() => core.checkConsentFolder('/'), /too broad/);
    assert.throws(() => core.checkConsentFolder(home), /too broad/);
    fs.mkdirSync(path.join(home, '.ssh'), { recursive: true });
    assert.throws(() => core.checkConsentFolder(path.join(home, '.ssh')), /credentials/);
    assert.throws(() => core.checkConsentFolder('relative/path'), /absolute/);
    assert.equal(core.checkConsentFolder(project), fs.realpathSync(project));
  });

  it('asks before adding a folder, remembers a decline, and saves an approval', async () => {
    let asks = 0;
    let answer = false;
    const client = new core.BridgeClient({ config: { workspaces: [] }, approveFolder: async () => (asks++, answer), log: () => {} });
    const no = await client.handle({ command: 'request_folder', payload: { path: project } });
    assert.equal(no.result.allowed, false);
    answer = true;
    const stillNo = await client.handle({ command: 'request_folder', payload: { path: project } });
    assert.equal(stillNo.result.allowed, false, 'a decline is not re-asked right away');
    assert.equal(asks, 1);

    client.declined.clear();
    const yes = await client.handle({ command: 'request_folder', payload: { path: project } });
    assert.equal(yes.result.allowed, true);
    assert.deepEqual(core.loadConfig().workspaces, [fs.realpathSync(project)]);
    assert.ok(core.CONFIG_PATH.startsWith(home));
  });
});
