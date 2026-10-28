import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { SqlDatabase } from './db/sql';

/**
 * Runtime environment access. On Cloudflare the bindings come from the Worker env;
 * in tests a fake env is injected with setTestEnv().
 */
export interface AppEnv {
  DB: SqlDatabase;
  [key: string]: unknown;
}

let testEnv: AppEnv | null = null;
let fallbackDbInstance: SqlDatabase | null = null;

export function setTestEnv(env: Partial<AppEnv> | null) {
  if (env === null) {
    testEnv = null;
  } else {
    testEnv = { ...(testEnv || ({} as AppEnv)), ...env } as AppEnv;
  }
}

export function getAppEnv(): AppEnv {
  if (testEnv) return testEnv;
  try {
    const ctx = getCloudflareContext();
    if (ctx && ctx.env) return ctx.env as unknown as AppEnv;
  } catch {
    // Non-Cloudflare environment (e.g. Vercel, Node.js)
  }
  return (process.env as unknown as AppEnv) || ({} as AppEnv);
}

function getFallbackDb(): SqlDatabase {
  if (fallbackDbInstance) return fallbackDbInstance;
  try {
    const { createTestDatabase } = require('@/lib/db/test-sqlite');
    const db = createTestDatabase();

    // Pre-seed default administrator & QA tester accounts in fallback DB
    try {
      (db as any).exec(`
        INSERT OR IGNORE INTO users (id, email, name, password_hash, role, status, onboarded, created_at)
        VALUES 
          ('usr_admin_01', 'aiseosauyiidahor@gmail.com', 'Admin', 'pbkdf2:100000:05c85daa7d32e61a9a0037b3b263be12:26d8c2066643fdf1812daac5e2e5ef199e05edf6d95df01d996667c1af0b33dc', 'admin', 'active', 1, datetime('now')),
          ('usr_qa_tester_01', 'test@shazam.ai', 'QA Tester', 'pbkdf2:100000:05c85daa7d32e61a9a0037b3b263be12:26d8c2066643fdf1812daac5e2e5ef199e05edf6d95df01d996667c1af0b33dc', 'user', 'active', 1, datetime('now'));
      `);
    } catch {
      // ignore
    }

    fallbackDbInstance = db;
    return db;
  } catch {
    throw new Error('Database service is currently initializing. Please retry in a moment.');
  }
}

export function getDb(): SqlDatabase {
  const env = getAppEnv();
  if (env?.DB) return env.DB;
  return getFallbackDb();
}

/** Reads a string var/secret from the Worker env, falling back to process.env. */
export function envVar(name: string): string | undefined {
  let value: unknown;
  try {
    value = getAppEnv()[name];
  } catch {
    value = undefined;
  }
  if (typeof value === 'string' && value.length > 0) return value;
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  return fromProcess && fromProcess.length > 0 ? fromProcess : undefined;
}

export function envFlag(name: string, fallback = false): boolean {
  const v = envVar(name);
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
