import { getDb } from '@/lib/env';
import type { SqlDatabase } from '@/lib/db/sql';
import { sha256Hex } from '@/lib/bridge/repo';
import { RunsRepo } from '@/lib/runs/repo';

/**
 * Minimal OAuth 2.1 authorization server for MCP clients (claude.ai custom connectors,
 * Claude Desktop, Codex/Antigravity "login" flows): RFC 7591 dynamic registration,
 * authorization code + PKCE (S256 only), rotating refresh tokens.
 */

export const ACCESS_TTL_S = 60 * 60 * 24 * 7; // 7 days
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 days
const CODE_TTL_MS = 5 * 60 * 1000;

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, '0')).join('');

export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    // Native/CLI clients use loopback redirects (RFC 8252).
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
  } catch {
    return false;
  }
}

/** Loopback redirects may use any port (RFC 8252 §7.3); everything else must match exactly. */
function redirectMatches(registered: string[], requested: string): boolean {
  return registered.some((r) => {
    if (r === requested) return true;
    try {
      const a = new URL(r);
      const b = new URL(requested);
      const loop = (h: string) => h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
      return a.protocol === 'http:' && loop(a.hostname) && loop(b.hostname) && a.pathname === b.pathname;
    } catch {
      return false;
    }
  });
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString('base64url');
}

export class OAuthServer {
  constructor(private db: SqlDatabase = getDb()) {}

  async registerClient(name: string, redirectUris: string[]): Promise<{ client_id: string; client_name: string; redirect_uris: string[] }> {
    if (!redirectUris.length || !redirectUris.every(isAllowedRedirectUri)) throw new Error('invalid_redirect_uri');
    const clientId = `mcp_${rand(16)}`;
    await this.db
      .prepare('INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
      .bind(clientId, name.slice(0, 80) || 'MCP client', JSON.stringify(redirectUris), new Date().toISOString())
      .run();
    return { client_id: clientId, client_name: name, redirect_uris: redirectUris };
  }

  async getClient(clientId: string): Promise<{ clientId: string; name: string; redirectUris: string[] } | null> {
    const r = await this.db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').bind(clientId).first<any>();
    return r ? { clientId: r.client_id, name: r.client_name, redirectUris: JSON.parse(r.redirect_uris) } : null;
  }

  async validateAuthorize(p: { response_type?: string | null; client_id?: string | null; redirect_uri?: string | null; code_challenge?: string | null; code_challenge_method?: string | null }) {
    if (p.response_type !== 'code') return { error: 'unsupported_response_type' as const };
    const client = p.client_id ? await this.getClient(p.client_id) : null;
    if (!client) return { error: 'invalid_client' as const };
    if (!p.redirect_uri || !redirectMatches(client.redirectUris, p.redirect_uri)) return { error: 'invalid_redirect_uri' as const };
    if (!p.code_challenge || p.code_challenge_method !== 'S256') return { error: 'invalid_request' as const, description: 'PKCE with S256 is required.' };
    return { client };
  }

  async issueCode(userId: string, clientId: string, redirectUri: string, codeChallenge: string): Promise<string> {
    const code = rand(24);
    await this.db
      .prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(code), clientId, userId, redirectUri, codeChallenge, new Date(Date.now() + CODE_TTL_MS).toISOString())
      .run();
    return code;
  }

  private async issueTokens(userId: string, clientId: string) {
    const client = await this.getClient(clientId);
    const runs = new RunsRepo(this.db);
    const { id, token } = await runs.createToken(userId, `${client?.name || 'MCP client'} (OAuth)`, new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString());
    const refresh = `shz_rt_${rand(24)}`;
    await this.db
      .prepare('INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, access_token_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(refresh), clientId, userId, id, new Date(Date.now() + REFRESH_TTL_MS).toISOString(), new Date().toISOString())
      .run();
    return { access_token: token, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: 'tasks' };
  }

  async exchangeCode(p: { code: string; client_id: string; redirect_uri: string; code_verifier: string }) {
    const now = new Date().toISOString();
    const row = await this.db
      .prepare('UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING client_id, user_id, redirect_uri, code_challenge')
      .bind(now, await sha256Hex(p.code), now)
      .first<any>();
    if (!row || row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri) return { error: 'invalid_grant' as const };
    if ((await s256(p.code_verifier || '')) !== row.code_challenge) return { error: 'invalid_grant' as const, description: 'PKCE verification failed.' };
    return { tokens: await this.issueTokens(row.user_id, row.client_id) };
  }

  /** Rotates the refresh token; a reused (already rotated) token revokes nothing new and fails. */
  async refresh(p: { refresh_token: string; client_id?: string }) {
    const now = new Date().toISOString();
    const row = await this.db
      .prepare('UPDATE oauth_refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? RETURNING client_id, user_id, access_token_id')
      .bind(now, await sha256Hex(p.refresh_token || ''), now)
      .first<any>();
    if (!row || (p.client_id && p.client_id !== row.client_id)) return { error: 'invalid_grant' as const };
    if (row.access_token_id) await new RunsRepo(this.db).revokeToken(row.user_id, row.access_token_id);
    return { tokens: await this.issueTokens(row.user_id, row.client_id) };
  }
}
