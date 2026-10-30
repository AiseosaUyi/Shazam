import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';
import type { SqlDatabase, SqlStatement } from './sql';
import { MIGRATIONS } from './migrations.generated';

/**
 * Persistent database for Vercel deployments: Turso (libSQL, SQLite dialect) behind the
 * same D1-shaped interface the repo already uses, so queries and migrations are unchanged.
 */

function normalize(v: unknown): any {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

function rowsToObjects<T>(rs: ResultSet): T[] {
  return rs.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    rs.columns.forEach((col, i) => {
      const value = row[i];
      obj[col] = typeof value === 'bigint' ? Number(value) : value;
    });
    return obj as T;
  });
}

class LibsqlStatement implements SqlStatement {
  args: any[] = [];

  constructor(private db: LibsqlDatabase, readonly sql: string) {}

  bind(...values: unknown[]): SqlStatement {
    this.args = values.map(normalize);
    return this;
  }

  toStatement(): InStatement {
    return { sql: this.sql, args: this.args };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rs = await this.db.execute(this.toStatement());
    return rowsToObjects<T>(rs)[0] ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rs = await this.db.execute(this.toStatement());
    return { results: rowsToObjects<T>(rs) };
  }

  async run(): Promise<{ meta?: { changes?: number } }> {
    const rs = await this.db.execute(this.toStatement());
    return { meta: { changes: rs.rowsAffected } };
  }
}

export class LibsqlDatabase implements SqlDatabase {
  private ready: Promise<void> | null = null;

  constructor(private client: Client) {}

  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = runMigrations(this.client).catch((err) => {
        this.ready = null; // retry on next request instead of caching the failure
        throw err;
      });
    }
    return this.ready;
  }

  async execute(stmt: InStatement): Promise<ResultSet> {
    await this.ensureReady();
    return this.client.execute(stmt);
  }

  prepare(query: string): SqlStatement {
    return new LibsqlStatement(this, query);
  }

  async batch(statements: SqlStatement[]): Promise<unknown[]> {
    await this.ensureReady();
    return this.client.batch(statements.map((s) => (s as LibsqlStatement).toStatement()), 'write');
  }
}

/** Applies each embedded migration exactly once, tracked in _shazam_migrations. */
export async function runMigrations(client: Client): Promise<void> {
  await client.execute('CREATE TABLE IF NOT EXISTS _shazam_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (await client.execute('SELECT name FROM _shazam_migrations')).rows.map((r) => String(r[0]))
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    await client.executeMultiple(m.sql);
    await client.execute({ sql: 'INSERT INTO _shazam_migrations (name, applied_at) VALUES (?, ?)', args: [m.name, new Date().toISOString()] });
  }
}

let instance: LibsqlDatabase | null = null;

export function getLibsqlDatabase(url: string, authToken?: string): LibsqlDatabase {
  if (!instance) instance = new LibsqlDatabase(createClient({ url, authToken, intMode: 'number' }));
  return instance;
}
