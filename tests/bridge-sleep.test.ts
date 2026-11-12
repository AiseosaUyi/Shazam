import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const { BridgeClient } = require('../desktop/bridge-core.js');

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void;

/** A fake Arcwork server: `handler` sees every request and can answer, hang or kill the socket. */
async function fakeServer(handler: Handler) {
  const hits: Record<string, number> = {};
  const log: string[] = [];
  const server = http.createServer((req, res) => {
    const key = req.url || '';
    hits[key] = (hits[key] || 0) + 1;
    log.push(key);
    req.on('data', () => {});
    req.on('end', () => handler(req, res, hits[key]));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, hits, log, close: () => { server.closeAllConnections?.(); server.close(); } };
}

const json = (res: http.ServerResponse, body: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const until = async (cond: () => boolean, ms: number) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); return cond(); };
const client = (url: string, extra: Record<string, unknown> = {}) => new BridgeClient({ config: { server: url, token: 't', workspaces: [] }, log: () => {}, ...extra });

describe('Bridge survives a sleeping Mac', () => {
  it('a poll that never answers (dead connection after sleep) times out and reconnects', async () => {
    const srv = await fakeServer((req, res, n) => {
      if (req.url!.endsWith('/poll')) { if (n === 1) return; /* hang forever */ return json(res, { commands: [] }); }
      json(res, {});
    });
    const c = client(srv.url, { pollTimeoutMs: 200 });
    void c.start();
    try {
      assert.ok(await until(() => (srv.hits['/api/v1/bridge/poll'] || 0) >= 2, 8000), 'a second poll arrived after the first hung');
    } finally { c.stop(); srv.close(); }
  });

  it('a clock jump (wake from sleep) aborts the in-flight poll right away', async () => {
    const srv = await fakeServer((req, res, n) => {
      if (req.url!.endsWith('/poll')) { if (n === 1) return; return json(res, { commands: [] }); }
      json(res, {});
    });
    const lines: string[] = [];
    const c = client(srv.url, { pollTimeoutMs: 60_000, wakeGapMs: 150, log: (l: string) => lines.push(l) });
    void c.start();
    try {
      assert.ok(await until(() => (srv.hits['/api/v1/bridge/poll'] || 0) >= 1, 8000));
      const t0 = Date.now();
      while (Date.now() - t0 < 400) { /* block the event loop like a suspended machine */ }
      assert.ok(await until(() => (srv.hits['/api/v1/bridge/poll'] || 0) >= 2, 4000), 'reconnected without waiting for the 60s timeout');
      assert.ok(lines.some((l) => /woke from sleep/.test(l)));
    } finally { c.stop(); srv.close(); }
  });

  it('retries delivering a command result when the first attempts fail', async () => {
    let delivered: any = null;
    const srv = await fakeServer((req, res, n) => {
      if (req.url!.endsWith('/poll')) return n === 1 ? json(res, { commands: [{ id: 'c1', command: 'no_such_command', payload: {} }] }) : void setTimeout(() => json(res, { commands: [] }), 300);
      if (req.url!.endsWith('/result')) {
        if (n <= 2) return void req.socket.destroy(); // network still down just after wake
        let body = '';
        req.on('data', (d) => (body += d));
        delivered = { n };
        return json(res, { ok: true });
      }
      json(res, {});
    });
    const c = client(srv.url, { resultRetries: 4 });
    void c.start();
    try {
      assert.ok(await until(() => delivered !== null, 10_000), 'result delivered eventually');
      assert.equal(srv.hits['/api/v1/bridge/result'], 3, 'two failures, then success');
    } finally { c.stop(); srv.close(); }
  });

  it('gives up on a result after the retries and says so, without crashing the loop', async () => {
    const lines: string[] = [];
    const srv = await fakeServer((req, res, n) => {
      if (req.url!.endsWith('/poll')) return n === 1 ? json(res, { commands: [{ id: 'c1', command: 'no_such_command', payload: {} }] }) : void setTimeout(() => json(res, { commands: [] }), 300);
      if (req.url!.endsWith('/result')) return void req.socket.destroy();
      json(res, {});
    });
    const c = client(srv.url, { resultRetries: 1, log: (l: string) => lines.push(l) });
    void c.start();
    try {
      assert.ok(await until(() => lines.some((l) => /could not deliver the result/.test(l)), 10_000));
      assert.equal(srv.hits['/api/v1/bridge/result'], 2);
      assert.ok(await until(() => (srv.hits['/api/v1/bridge/poll'] || 0) >= 2, 5000), 'still polling');
    } finally { c.stop(); srv.close(); }
  });

  it('a revoked token (401) still stops the bridge', async () => {
    const srv = await fakeServer((req, res) => { res.statusCode = 401; res.end('{}'); });
    const statuses: string[] = [];
    const c = client(srv.url, { onStatus: (s: string) => statuses.push(s) });
    await c.start();
    srv.close();
    assert.ok(statuses.includes('revoked'));
  });
});
