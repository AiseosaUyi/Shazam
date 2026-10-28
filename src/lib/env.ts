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
    // Fall back to process.env in dev/node environments
  }
  return (process.env as unknown as AppEnv) || ({} as AppEnv);
}

export function getDb(): SqlDatabase {
  const env = getAppEnv();
  const db = env?.DB;
  if (!db) {
    throw new Error('Database service is currently initializing. Please retry in a moment.');
  }
  return db;
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
