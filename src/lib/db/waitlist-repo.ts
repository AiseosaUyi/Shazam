import { getDb } from '@/lib/env';

export type WaitlistStatus = 'pending' | 'invited' | 'declined';

export interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  useCase: string | null;
  source: string;
  userId: string | null;
  status: WaitlistStatus;
  createdAt: string;
  invitedAt: string | null;
}

function row(r: any): WaitlistEntry {
  return {
    id: r.id,
    email: r.email,
    name: r.name ?? null,
    useCase: r.use_case ?? null,
    source: r.source,
    userId: r.user_id ?? null,
    status: r.status,
    createdAt: r.created_at,
    invitedAt: r.invited_at ?? null,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class WaitlistRepo {
  constructor(private db = getDb()) {}

  /** Idempotent: joining twice keeps the original place in line (and fills in missing details). */
  async join(input: { email: string; name?: string | null; useCase?: string | null; source?: string; userId?: string | null }): Promise<{ entry: WaitlistEntry; created: boolean }> {
    const email = normalizeEmail(input.email);
    const existing = await this.getByEmail(email);
    if (existing) {
      await this.db
        .prepare('UPDATE waitlist SET name = COALESCE(name, ?), use_case = COALESCE(use_case, ?), user_id = COALESCE(user_id, ?) WHERE id = ?')
        .bind(input.name || null, input.useCase || null, input.userId || null, existing.id)
        .run();
      return { entry: (await this.getByEmail(email))!, created: false };
    }
    const id = crypto.randomUUID();
    await this.db
      .prepare('INSERT INTO waitlist (id, email, name, use_case, source, user_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, email, input.name || null, input.useCase || null, input.source || 'web', input.userId || null, 'pending', new Date().toISOString())
      .run();
    return { entry: (await this.getByEmail(email))!, created: true };
  }

  async getByEmail(email: string): Promise<WaitlistEntry | null> {
    const r = await this.db.prepare('SELECT * FROM waitlist WHERE email = ?').bind(normalizeEmail(email)).first<any>();
    return r ? row(r) : null;
  }

  async list(status?: WaitlistStatus): Promise<WaitlistEntry[]> {
    const q = status
      ? this.db.prepare('SELECT * FROM waitlist WHERE status = ? ORDER BY created_at ASC').bind(status)
      : this.db.prepare('SELECT * FROM waitlist ORDER BY created_at ASC');
    const { results } = await q.all<any>();
    return (results || []).map(row);
  }

  async setStatus(id: string, status: WaitlistStatus): Promise<boolean> {
    const res = await this.db
      .prepare('UPDATE waitlist SET status = ?, invited_at = CASE WHEN ? = \'invited\' THEN ? ELSE invited_at END WHERE id = ?')
      .bind(status, status, new Date().toISOString(), id)
      .run();
    return ((res as any)?.meta?.changes ?? 0) > 0;
  }

  async deleteByEmail(email: string): Promise<void> {
    await this.db.prepare('DELETE FROM waitlist WHERE email = ?').bind(normalizeEmail(email)).run();
  }
}
