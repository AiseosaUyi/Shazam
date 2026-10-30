import { getDb } from '@/lib/env';
import type { SqlDatabase } from './sql';

/**
 * Persistence for the Co-Work platform: skills, OAuth connections, scheduled jobs,
 * the human-approval queue and generated media. Every query is scoped by user_id.
 */

export type AgentMode = 'chat' | 'cowork' | 'code';

export interface Skill {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  modes: AgentMode[];
  enabled: boolean;
  version: number;
  updatedAt: string;
}

export interface OAuthConnection {
  id: string;
  userId: string;
  provider: string;
  accountEmail: string | null;
  scopes: string;
  encryptedRefreshToken: string | null;
  encryptedAccessToken: string | null;
  accessExpiresAt: string | null;
}

export type JobStatus = 'scheduled' | 'running' | 'done' | 'failed' | 'cancelled' | 'paused';

export interface ScheduledJob {
  id: string;
  userId: string;
  kind: 'email' | 'agent_task';
  title: string;
  payload: any;
  runAt: string;
  recurrence: string | null;
  timezone: string;
  status: JobStatus;
  attempts: number;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface PendingAction {
  id: string;
  userId: string;
  kind: string;
  summary: string;
  payload: any;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  result: string | null;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  userId: string;
  kind: 'image' | 'video';
  url: string;
  prompt: string | null;
  model: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

function toSkill(r: any): Skill {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    slug: r.slug,
    description: r.description || '',
    instructions: r.instructions,
    modes: JSON.parse(r.modes || '["cowork","code"]'),
    enabled: Boolean(r.enabled),
    version: Number(r.version || 1),
    updatedAt: r.updated_at,
  };
}

function toJob(r: any): ScheduledJob {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    title: r.title,
    payload: JSON.parse(r.payload || '{}'),
    runAt: r.run_at,
    recurrence: r.recurrence,
    timezone: r.timezone,
    status: r.status,
    attempts: Number(r.attempts || 0),
    lastRunAt: r.last_run_at,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

function toPending(r: any): PendingAction {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    summary: r.summary,
    payload: JSON.parse(r.payload || '{}'),
    status: r.status,
    result: r.result,
    createdAt: r.created_at,
  };
}

export class PlatformRepo {
  constructor(private db: SqlDatabase = getDb()) {}

  // ---------------- Skills ----------------

  async listSkills(userId: string, mode?: AgentMode): Promise<Skill[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM skills WHERE user_id = ? ORDER BY name ASC')
      .bind(userId)
      .all<any>();
    const skills = results.map(toSkill);
    return mode ? skills.filter((s) => s.modes.includes(mode)) : skills;
  }

  async getSkill(userId: string, idOrSlug: string): Promise<Skill | null> {
    const r = await this.db
      .prepare('SELECT * FROM skills WHERE user_id = ? AND (id = ? OR slug = ?)')
      .bind(userId, idOrSlug, idOrSlug)
      .first<any>();
    return r ? toSkill(r) : null;
  }

  /** Creates or updates a skill by slug; bumps the version on every content change. */
  async upsertSkill(userId: string, s: { name: string; slug: string; description: string; instructions: string; modes?: AgentMode[]; enabled?: boolean }): Promise<Skill> {
    const existing = await this.getSkill(userId, s.slug);
    const ts = now();
    const modes = JSON.stringify(s.modes || existing?.modes || ['cowork', 'code']);
    if (existing) {
      await this.db
        .prepare('UPDATE skills SET name = ?, description = ?, instructions = ?, modes = ?, enabled = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND id = ?')
        .bind(s.name, s.description, s.instructions, modes, s.enabled ?? existing.enabled, ts, userId, existing.id)
        .run();
    } else {
      await this.db
        .prepare('INSERT INTO skills (id, user_id, name, slug, description, instructions, tools, enabled, modes, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
        .bind(newId('skl'), userId, s.name, s.slug, s.description, s.instructions, '[]', s.enabled ?? true, modes, ts, ts)
        .run();
    }
    return (await this.getSkill(userId, s.slug))!;
  }

  async setSkillEnabled(userId: string, id: string, enabled: boolean): Promise<boolean> {
    const r = await this.db.prepare('UPDATE skills SET enabled = ?, updated_at = ? WHERE user_id = ? AND id = ?').bind(enabled, now(), userId, id).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async deleteSkill(userId: string, id: string): Promise<boolean> {
    const r = await this.db.prepare('DELETE FROM skills WHERE user_id = ? AND id = ?').bind(userId, id).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  // ---------------- OAuth connections ----------------

  async getOAuth(userId: string, provider: string): Promise<OAuthConnection | null> {
    const r = await this.db.prepare('SELECT * FROM oauth_connections WHERE user_id = ? AND provider = ?').bind(userId, provider).first<any>();
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      provider: r.provider,
      accountEmail: r.account_email,
      scopes: r.scopes,
      encryptedRefreshToken: r.encrypted_refresh_token,
      encryptedAccessToken: r.encrypted_access_token,
      accessExpiresAt: r.access_expires_at,
    };
  }

  async upsertOAuth(userId: string, provider: string, data: { accountEmail?: string | null; scopes: string; encryptedRefreshToken?: string | null; encryptedAccessToken: string; accessExpiresAt: string }): Promise<void> {
    const existing = await this.getOAuth(userId, provider);
    const ts = now();
    if (existing) {
      await this.db
        .prepare('UPDATE oauth_connections SET account_email = COALESCE(?, account_email), scopes = ?, encrypted_refresh_token = COALESCE(?, encrypted_refresh_token), encrypted_access_token = ?, access_expires_at = ?, updated_at = ? WHERE id = ?')
        .bind(data.accountEmail ?? null, data.scopes, data.encryptedRefreshToken ?? null, data.encryptedAccessToken, data.accessExpiresAt, ts, existing.id)
        .run();
    } else {
      await this.db
        .prepare('INSERT INTO oauth_connections (id, user_id, provider, account_email, scopes, encrypted_refresh_token, encrypted_access_token, access_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(newId('oac'), userId, provider, data.accountEmail ?? null, data.scopes, data.encryptedRefreshToken ?? null, data.encryptedAccessToken, data.accessExpiresAt, ts, ts)
        .run();
    }
  }

  async deleteOAuth(userId: string, provider: string): Promise<void> {
    await this.db.prepare('DELETE FROM oauth_connections WHERE user_id = ? AND provider = ?').bind(userId, provider).run();
  }

  // ---------------- Scheduled jobs ----------------

  async createJob(userId: string, job: { kind: ScheduledJob['kind']; title: string; payload: unknown; runAt: string; recurrence?: string | null; timezone?: string; idempotencyKey?: string }): Promise<ScheduledJob> {
    const id = newId('job');
    const ts = now();
    await this.db
      .prepare('INSERT INTO scheduled_jobs (id, user_id, kind, title, payload, run_at, recurrence, timezone, status, idempotency_key, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'scheduled\', ?, 0, ?, ?)')
      .bind(id, userId, job.kind, job.title, JSON.stringify(job.payload), job.runAt, job.recurrence ?? null, job.timezone || 'UTC', job.idempotencyKey || id, ts, ts)
      .run();
    return (await this.getJob(userId, id))!;
  }

  async getJob(userId: string, id: string): Promise<ScheduledJob | null> {
    const r = await this.db.prepare('SELECT * FROM scheduled_jobs WHERE user_id = ? AND id = ?').bind(userId, id).first<any>();
    return r ? toJob(r) : null;
  }

  async listJobs(userId: string, opts: { includeFinished?: boolean } = {}): Promise<ScheduledJob[]> {
    const sql = opts.includeFinished
      ? 'SELECT * FROM scheduled_jobs WHERE user_id = ? ORDER BY run_at DESC LIMIT 200'
      : "SELECT * FROM scheduled_jobs WHERE user_id = ? AND status IN ('scheduled','running','paused','failed') ORDER BY run_at ASC LIMIT 200";
    const { results } = await this.db.prepare(sql).bind(userId).all<any>();
    return results.map(toJob);
  }

  async setJobStatus(userId: string, id: string, status: Extract<JobStatus, 'cancelled' | 'paused' | 'scheduled'>): Promise<boolean> {
    const r = await this.db
      .prepare("UPDATE scheduled_jobs SET status = ?, updated_at = ? WHERE user_id = ? AND id = ? AND status IN ('scheduled','paused','failed')")
      .bind(status, now(), userId, id)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async updateJob(userId: string, id: string, fields: { title?: string; runAt?: string; payload?: unknown; recurrence?: string | null }): Promise<boolean> {
    const job = await this.getJob(userId, id);
    if (!job || !['scheduled', 'paused', 'failed'].includes(job.status)) return false;
    await this.db
      .prepare("UPDATE scheduled_jobs SET title = ?, run_at = ?, payload = ?, recurrence = ?, status = 'scheduled', updated_at = ? WHERE user_id = ? AND id = ?")
      .bind(fields.title ?? job.title, fields.runAt ?? job.runAt, JSON.stringify(fields.payload ?? job.payload), fields.recurrence === undefined ? job.recurrence : fields.recurrence, now(), userId, id)
      .run();
    return true;
  }

  /**
   * Atomically claims due jobs for this worker. A lock lease prevents two overlapping cron
   * invocations from sending the same email twice; a crashed run becomes claimable again.
   */
  async claimDueJobs(limit = 10, leaseMs = 4 * 60 * 1000): Promise<ScheduledJob[]> {
    const ts = now();
    const lease = new Date(Date.now() + leaseMs).toISOString();
    const { results } = await this.db
      .prepare(
        `UPDATE scheduled_jobs SET status = 'running', locked_until = ?, attempts = attempts + 1, updated_at = ?
         WHERE id IN (
           SELECT id FROM scheduled_jobs
           WHERE run_at <= ? AND (status = 'scheduled' OR (status = 'running' AND locked_until < ?))
           ORDER BY run_at ASC LIMIT ?
         )
         RETURNING *`
      )
      .bind(lease, ts, ts, ts, limit)
      .all<any>();
    return results.map(toJob);
  }

  async finishJob(job: ScheduledJob, outcome: { ok: boolean; output: string; nextRunAt?: string | null }): Promise<void> {
    const ts = now();
    let status: JobStatus = outcome.ok ? 'done' : job.attempts >= 3 ? 'failed' : 'scheduled';
    let runAt = job.runAt;
    if (!outcome.ok && status === 'scheduled') {
      runAt = new Date(Date.now() + job.attempts * 2 * 60 * 1000).toISOString(); // backoff retry
    }
    if (outcome.ok && outcome.nextRunAt) {
      status = 'scheduled';
      runAt = outcome.nextRunAt;
    }
    await this.db
      .prepare('UPDATE scheduled_jobs SET status = ?, run_at = ?, last_run_at = ?, last_error = ?, locked_until = NULL, attempts = ?, updated_at = ? WHERE id = ?')
      .bind(status, runAt, ts, outcome.ok ? null : outcome.output.slice(0, 2000), outcome.ok ? 0 : job.attempts, ts, job.id)
      .run();
    await this.db
      .prepare('INSERT INTO job_runs (id, job_id, user_id, started_at, finished_at, status, output) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId('run'), job.id, job.userId, job.lastRunAt || ts, ts, outcome.ok ? 'ok' : 'error', outcome.output.slice(0, 8000))
      .run();
  }

  async listJobRuns(userId: string, jobId: string): Promise<Array<{ startedAt: string; finishedAt: string | null; status: string; output: string | null }>> {
    const { results } = await this.db
      .prepare('SELECT * FROM job_runs WHERE user_id = ? AND job_id = ? ORDER BY started_at DESC LIMIT 50')
      .bind(userId, jobId)
      .all<any>();
    return results.map((r) => ({ startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, output: r.output }));
  }

  // ---------------- Human approval queue ----------------

  async createPendingAction(userId: string, kind: string, summary: string, payload: unknown): Promise<PendingAction> {
    const id = newId('act');
    await this.db
      .prepare("INSERT INTO pending_actions (id, user_id, kind, summary, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
      .bind(id, userId, kind, summary, JSON.stringify(payload), now())
      .run();
    return (await this.getPendingAction(userId, id))!;
  }

  async getPendingAction(userId: string, id: string): Promise<PendingAction | null> {
    const r = await this.db.prepare('SELECT * FROM pending_actions WHERE user_id = ? AND id = ?').bind(userId, id).first<any>();
    return r ? toPending(r) : null;
  }

  async listPendingActions(userId: string): Promise<PendingAction[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM pending_actions WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 50")
      .bind(userId)
      .all<any>();
    return results.map(toPending);
  }

  /** Moves pending → approved/rejected exactly once (so a double-click can't send twice). */
  async decidePendingAction(userId: string, id: string, decision: 'approved' | 'rejected'): Promise<boolean> {
    const r = await this.db
      .prepare("UPDATE pending_actions SET status = ?, decided_at = ? WHERE user_id = ? AND id = ? AND status = 'pending'")
      .bind(decision, now(), userId, id)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async completePendingAction(userId: string, id: string, ok: boolean, result: string): Promise<void> {
    await this.db
      .prepare('UPDATE pending_actions SET status = ?, result = ? WHERE user_id = ? AND id = ?')
      .bind(ok ? 'executed' : 'failed', result.slice(0, 8000), userId, id)
      .run();
  }

  // ---------------- Media ----------------

  async addMedia(userId: string, m: { kind: MediaAsset['kind']; url: string; prompt?: string; model?: string; meta?: Record<string, unknown> }): Promise<MediaAsset> {
    const id = newId('med');
    const ts = now();
    await this.db
      .prepare('INSERT INTO media_assets (id, user_id, kind, url, prompt, model, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, userId, m.kind, m.url, m.prompt ?? null, m.model ?? null, JSON.stringify(m.meta || {}), ts)
      .run();
    return { id, userId, kind: m.kind, url: m.url, prompt: m.prompt ?? null, model: m.model ?? null, meta: m.meta || {}, createdAt: ts };
  }

  async listMedia(userId: string, kind?: MediaAsset['kind']): Promise<MediaAsset[]> {
    const { results } = await this.db
      .prepare(kind ? 'SELECT * FROM media_assets WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 200' : 'SELECT * FROM media_assets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
      .bind(...(kind ? [userId, kind] : [userId]))
      .all<any>();
    return results.map((r) => ({ id: r.id, userId: r.user_id, kind: r.kind, url: r.url, prompt: r.prompt, model: r.model, meta: JSON.parse(r.meta || '{}'), createdAt: r.created_at }));
  }
}
