import { getDb } from '@/lib/env';
import type { SqlDatabase } from '@/lib/db/sql';
import { sha256Hex } from '@/lib/bridge/repo';
import type { GitState, RunRecord, RunReport } from './report';

export type RunAgent = 'code' | 'cowork';
/**
 * paused = stopped at a serverless time limit with a checkpoint; resumes automatically.
 * no_changes = the task asked for changes but the run recorded no successful edit or write.
 * stalled = the run went too many steps without editing and was stopped.
 */
export type RunStatus = 'queued' | 'running' | 'paused' | 'done' | 'no_changes' | 'stalled' | 'error' | 'cancelled';

/** Statuses a run never leaves on its own. */
export const TERMINAL_STATUSES: readonly RunStatus[] = ['done', 'no_changes', 'stalled', 'error', 'cancelled'];
export const isTerminalStatus = (s: string): boolean => (TERMINAL_STATUSES as readonly string[]).includes(s);

/** Settings a run keeps across resumed segments. */
export interface RunOptions {
  pinnedModel?: string | null;
  timezone?: string;
  maxSteps?: number;
  /** Steps already used by earlier segments (the step budget is for the whole run). */
  stepsUsed?: number;
  /** Tool calls since the last successful edit, across segments (stall guard). */
  stepsSinceEdit?: number;
  /** Git state when the run began (null = not a git repo). Set on the first segment. */
  gitBaseline?: GitState | null;
  /** Edits and commands recorded so far, across resumed segments. */
  record?: RunRecord;
  /** Final report, computed from recorded events when the run ends. */
  report?: RunReport;
}

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
  /** Saved conversation (model messages) to resume from; null until the first step ends. */
  checkpoint: unknown[] | null;
  /** How many invocations this run has used (0 = first). */
  segment: number;
  options: RunOptions;
  leaseUntil: string | null;
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
  checkpoint: r.checkpoint ? JSON.parse(r.checkpoint) : null,
  segment: Number(r.segment || 0),
  options: JSON.parse(r.options || '{}'),
  leaseUntil: r.lease_until ?? null,
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

  /** Marks a queued, running or paused run as cancelled. Returns false when it already finished. */
  async cancel(userId: string, id: string): Promise<boolean> {
    const cur = await this.get(userId, id);
    if (!cur || !['queued', 'running', 'paused'].includes(cur.status)) return false;
    await this.update(userId, id, { status: 'cancelled', events: [...cur.events, { at: new Date().toISOString(), type: 'note', text: 'Stopped by you.' }] });
    await this.setLease(userId, id, null);
    return true;
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
        cur.status === 'cancelled' ? 'cancelled' : (f.status ?? cur.status),
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

  async saveOptions(userId: string, id: string, options: RunOptions): Promise<void> {
    await this.db.prepare('UPDATE agent_runs SET options = ? WHERE user_id = ? AND id = ?').bind(JSON.stringify(options), userId, id).run();
  }

  /** Saves the conversation so far; cheap enough to call after every agent step. */
  async saveCheckpoint(userId: string, id: string, messages: unknown[]): Promise<void> {
    await this.db
      .prepare('UPDATE agent_runs SET checkpoint = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .bind(JSON.stringify(messages), new Date().toISOString(), userId, id)
      .run();
  }

  /** Marks the run as owned by a live invocation until `leaseUntil`. */
  async setLease(userId: string, id: string, leaseUntil: string | null): Promise<void> {
    await this.db.prepare('UPDATE agent_runs SET lease_until = ? WHERE user_id = ? AND id = ?').bind(leaseUntil, userId, id).run();
  }

  /**
   * Atomically claims one run that should continue: paused at a time limit, or "running" but
   * its invocation died (lease expired, or a pre-checkpoint run silent for `staleMs`). Returns
   * null when nothing is waiting. The claim sets a fresh lease so two resumers never race.
   */
  /**
   * Fails runs nobody owns any more, so recovery never restarts work the person moved on from
   * (and that could overwrite newer changes): runs with no lease silent for `noLeaseMs` (from
   * before checkpoints existed, or that crashed before starting), and leased runs whose owner
   * died more than `abandonedMs` ago.
   */
  async expireAbandoned(noLeaseMs = 20 * 60_000, abandonedMs = 2 * 3600_000): Promise<number> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const r = await this.db
      .prepare(
        `UPDATE agent_runs SET status = 'error', error = 'This run stopped unexpectedly before it could save progress. Send feedback to continue it.', lease_until = NULL, updated_at = ?
          WHERE (status IN ('queued','running') AND lease_until IS NULL AND updated_at < ?)
             OR (status IN ('running','paused') AND lease_until IS NOT NULL AND lease_until < ?)`
      )
      .bind(nowIso, new Date(now - noLeaseMs).toISOString(), new Date(now - abandonedMs).toISOString())
      .run();
    return r.meta?.changes ?? 0;
  }

  /**
   * Atomically claims one run that should continue: paused at a time limit, or "running" whose
   * invocation died (lease expired). Returns null when nothing is waiting. The claim sets a
   * fresh lease so two resumers never race.
   */
  async claimResumable(leaseMs: number): Promise<AgentRun | null> {
    await this.expireAbandoned();
    const now = new Date();
    const nowIso = now.toISOString();
    const { results } = await this.db
      .prepare(
        `SELECT id, user_id FROM agent_runs
          WHERE (status = 'paused' AND (lease_until IS NULL OR lease_until < ?))
             OR (status = 'running' AND lease_until IS NOT NULL AND lease_until < ?)
          ORDER BY updated_at ASC LIMIT 5`
      )
      .bind(nowIso, nowIso)
      .all<any>();
    const lease = new Date(now.getTime() + leaseMs).toISOString();
    for (const r of results) {
      const claimed = await this.db
        .prepare(
          `UPDATE agent_runs SET lease_until = ?, status = 'running', segment = segment + 1, updated_at = ?
            WHERE id = ? AND ((status = 'paused' AND (lease_until IS NULL OR lease_until < ?))
                           OR (status = 'running' AND lease_until IS NOT NULL AND lease_until < ?))`
        )
        .bind(lease, nowIso, r.id, nowIso, nowIso)
        .run();
      if ((claimed.meta?.changes ?? 0) > 0) return this.get(r.user_id, r.id);
    }
    return null;
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
