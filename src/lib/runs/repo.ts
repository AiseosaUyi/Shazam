import { getDb } from '@/lib/env';
import type { SqlDatabase } from '@/lib/db/sql';
import { sha256Hex } from '@/lib/bridge/repo';

export type RunAgent = 'code' | 'cowork';
export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunEvent {
  at: string;
  type: 'step' | 'result' | 'approval' | 'media' | 'note' | 'error' | 'preview' | 'file' | 'project' | 'question' | 'answer' | 'plan';
  text: string;
}

export interface AgentRun {
  id: string;
  userId: string;
  agent: RunAgent;
  prompt: string;
  projectId: string | null;
  parentRunId: string | null;
  source: string;
  status: RunStatus;
  model: string | null;
  events: RunEvent[];
  result: string | null;
  filesChanged: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const toRun = (r: any): AgentRun => ({
  id: r.id,
  userId: r.user_id,
  agent: r.agent,
  prompt: r.prompt,
  projectId: r.project_id,
  parentRunId: r.parent_run_id,
  source: r.source,
  status: r.status,
  model: r.model,
  events: JSON.parse(r.events || '[]'),
  result: r.result,
  filesChanged: JSON.parse(r.files_changed || '[]'),
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const rid = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;

export class RunsRepo {
  constructor(private db: SqlDatabase = getDb()) {}

  async create(userId: string, r: { agent: RunAgent; prompt: string; projectId?: string | null; parentRunId?: string | null; source?: string }): Promise<AgentRun> {
    const id = rid('run');
    const now = new Date().toISOString();
    await this.db
      .prepare("INSERT INTO agent_runs (id, user_id, agent, prompt, project_id, parent_run_id, source, status, events, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', '[]', ?, ?)")
      .bind(id, userId, r.agent, r.prompt, r.projectId ?? null, r.parentRunId ?? null, r.source || 'web', now, now)
      .run();
    return (await this.get(userId, id))!;
  }

  async get(userId: string, id: string): Promise<AgentRun | null> {
    const r = await this.db.prepare('SELECT * FROM agent_runs WHERE user_id = ? AND id = ?').bind(userId, id).first<any>();
    return r ? toRun(r) : null;
  }

  async setProject(userId: string, id: string, projectId: string): Promise<void> {
    await this.db.prepare('UPDATE agent_runs SET project_id = ? WHERE user_id = ? AND id = ?').bind(projectId, userId, id).run();
  }

  async list(userId: string, limit = 20): Promise<AgentRun[]> {
    const { results } = await this.db.prepare('SELECT * FROM agent_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').bind(userId, limit).all<any>();
    return results.map(toRun);
  }

  async update(userId: string, id: string, f: Partial<Pick<AgentRun, 'status' | 'model' | 'events' | 'result' | 'filesChanged' | 'error'>>): Promise<void> {
    const cur = await this.get(userId, id);
    if (!cur) return;
    await this.db
      .prepare('UPDATE agent_runs SET status = ?, model = ?, events = ?, result = ?, files_changed = ?, error = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .bind(
        f.status ?? cur.status,
        f.model ?? cur.model,
        JSON.stringify((f.events ?? cur.events).slice(-200)),
        f.result ?? cur.result,
        JSON.stringify(f.filesChanged ?? cur.filesChanged),
        f.error ?? cur.error,
        new Date().toISOString(),
        userId,
        id
      )
      .run();
  }

  // ---------------- Personal access tokens (MCP clients) ----------------

  async createToken(userId: string, name: string, expiresAt?: string): Promise<{ id: string; token: string }> {
    const raw = crypto.getRandomValues(new Uint8Array(24));
    const token = `shz_pat_${Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    const id = rid('pat');
    await this.db
      .prepare('INSERT INTO access_tokens (id, user_id, name, token_hash, token_hint, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, userId, name.slice(0, 60), await sha256Hex(token), `${token.slice(0, 12)}…${token.slice(-4)}`, 'tasks', new Date().toISOString(), expiresAt ?? null)
      .run();
    return { id, token };
  }

  async verifyToken(token: string): Promise<{ userId: string; tokenId: string } | null> {
    if (!token.startsWith('shz_pat_')) return null;
    const r = await this.db
      .prepare('SELECT id, user_id FROM access_tokens WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)')
      .bind(await sha256Hex(token), new Date().toISOString())
      .first<any>();
    if (!r) return null;
    await this.db.prepare('UPDATE access_tokens SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), r.id).run();
    return { userId: r.user_id, tokenId: r.id };
  }

  async listTokens(userId: string): Promise<Array<{ id: string; name: string; hint: string; lastUsedAt: string | null; createdAt: string }>> {
    const { results } = await this.db
      .prepare('SELECT id, name, token_hint, last_used_at, created_at FROM access_tokens WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC')
      .bind(userId, new Date().toISOString())
      .all<any>();
    return results.map((r) => ({ id: r.id, name: r.name, hint: r.token_hint, lastUsedAt: r.last_used_at, createdAt: r.created_at }));
  }

  async revokeToken(userId: string, id: string): Promise<boolean> {
    const r = await this.db.prepare('UPDATE access_tokens SET revoked_at = ? WHERE user_id = ? AND id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), userId, id).run();
    return (r.meta?.changes ?? 0) > 0;
  }
}
