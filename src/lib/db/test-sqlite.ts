import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { SqlDatabase, SqlStatement } from './sql';

class SqliteStatementAdapter implements SqlStatement {
  private stmt: any;
  private boundValues: any[] = [];

  constructor(private db: DatabaseSync, private sql: string) {
    this.stmt = this.db.prepare(this.sql);
  }

  bind(...values: unknown[]): SqlStatement {
    this.boundValues = values.map((v) => {
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (v === undefined) return null;
      return v;
    });
    return this;
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.stmt.get(...this.boundValues);
    return (row as T) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.stmt.all(...this.boundValues);
    return { results: (rows as T[]) ?? [] };
  }

  async run(): Promise<{ meta?: { changes?: number } }> {
    const result = this.stmt.run(...this.boundValues);
    return { meta: { changes: Number(result.changes) } };
  }
}

export class SqliteDatabaseAdapter implements SqlDatabase {
  private db: DatabaseSync;

  constructor(filePath = ':memory:') {
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  prepare(query: string): SqlStatement {
    return new SqliteStatementAdapter(this.db, query);
  }

  async batch(statements: SqlStatement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  applyMigrationFile(migrationPath: string): void {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    this.db.exec(sql);
  }
}

export function createTestDatabase(): SqliteDatabaseAdapter {
  const db = new SqliteDatabaseAdapter(':memory:');
  const migrationPath = path.resolve(process.cwd(), 'migrations', '0001_init.sql');
  if (fs.existsSync(migrationPath)) {
    db.applyMigrationFile(migrationPath);
  }
  return db;
}

export function createTestRepo() {
  const { DbRepo } = require('./repo');
  const { setTestEnv } = require('../env');
  const db = createTestDatabase();
  setTestEnv({ DB: db });
  return new DbRepo(db);
}

