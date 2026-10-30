import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '@/lib/db/test-sqlite';
import { DbRepo } from '@/lib/db/repo';
import { OAuthServer, isAllowedRedirectUri } from '@/lib/oauth/server';
import { RunsRepo } from '@/lib/runs/repo';

async function pkce() {
  const verifier = 'v'.repeat(43) + Math.random().toString(36).slice(2);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: Buffer.from(digest).toString('base64url') };
}

describe('OAuth 2.1 for MCP connectors (claude.ai)', () => {
  it('runs register → authorize (PKCE) → token → refresh rotation', async () => {
    const db = createTestDatabase();
    await new DbRepo(db).createUser({ id: 'u1', email: 'a@x.com', name: 'A', passwordHash: 'h', role: 'user' });
    const server = new OAuthServer(db);
    const runs = new RunsRepo(db);
    const redirect = 'https://claude.ai/api/mcp/auth_callback';

    const client = await server.registerClient('Claude', [redirect]);
    const { verifier, challenge } = await pkce();
    const v = await server.validateAuthorize({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
    assert.ok(!('error' in v));

    const code = await server.issueCode('u1', client.client_id, redirect, challenge);
    assert.ok('error' in (await server.exchangeCode({ code, client_id: client.client_id, redirect_uri: redirect, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier' })), 'bad PKCE verifier is rejected');

    const code2 = await server.issueCode('u1', client.client_id, redirect, challenge);
    const ok = await server.exchangeCode({ code: code2, client_id: client.client_id, redirect_uri: redirect, code_verifier: verifier });
    assert.ok('tokens' in ok);
    const tokens = (ok as any).tokens;
    assert.equal((await runs.verifyToken(tokens.access_token))?.userId, 'u1');
    assert.ok('error' in (await server.exchangeCode({ code: code2, client_id: client.client_id, redirect_uri: redirect, code_verifier: verifier })), 'codes are single-use');

    const refreshed = await server.refresh({ refresh_token: tokens.refresh_token, client_id: client.client_id });
    assert.ok('tokens' in refreshed);
    assert.equal(await runs.verifyToken(tokens.access_token), null, 'old access token is revoked on refresh');
    assert.ok('error' in (await server.refresh({ refresh_token: tokens.refresh_token })), 'refresh tokens rotate (no reuse)');
  });

  it('rejects unsafe redirect URIs and missing PKCE', async () => {
    assert.ok(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback'));
    assert.ok(isAllowedRedirectUri('http://127.0.0.1:53682/callback'));
    assert.ok(!isAllowedRedirectUri('http://evil.example.com/cb'));
    assert.ok(!isAllowedRedirectUri('javascript:alert(1)'));
    const db = createTestDatabase();
    const server = new OAuthServer(db);
    const c = await server.registerClient('CLI', ['http://127.0.0.1/callback']);
    const loop = await server.validateAuthorize({ response_type: 'code', client_id: c.client_id, redirect_uri: 'http://127.0.0.1:61000/callback', code_challenge: 'x', code_challenge_method: 'S256' });
    assert.ok(!('error' in loop), 'loopback port may vary');
    const noPkce = await server.validateAuthorize({ response_type: 'code', client_id: c.client_id, redirect_uri: 'http://127.0.0.1/callback', code_challenge: null, code_challenge_method: null });
    assert.ok('error' in noPkce);
  });
});
