import { getDb } from '@/lib/env';
import type { SqlDatabase } from '@/lib/db/sql';

/**
 * Device bridge persistence. Device tokens and pairing codes are stored only as SHA-256
 * hashes; the raw token lives on the device.
 */

export type DeviceKind = 'desktop' | 'browser';

export interface BridgeDevice {
  id: string;
  userId: string;
  kind: DeviceKind;
  name: string;
  capabilities: Record<string, unknown>;
  lastSeenAt: string | null;
  createdAt: string;
}

export const ONLINE_WINDOW_MS = 75_000;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const toDevice = (r: any): BridgeDevice => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  name: r.name,
  capabilities: JSON.parse(r.capabilities || '{}'),
  lastSeenAt: r.last_seen_at,
  createdAt: r.created_at,
});

export class BridgeRepo {
  constructor(private db: SqlDatabase = getDb()) {}

  /** 8-character, human-typeable code valid for 10 minutes. */
  async createPairingCode(userId: string): Promise<{ code: string; expiresAt: string }> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const raw = crypto.getRandomValues(new Uint8Array(8));
    const code = Array.from(raw).map((b) => alphabet[b % alphabet.length]).join('');
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await this.db
      .prepare('INSERT INTO bridge_pairing_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(code), userId, expiresAt)
      .run();
    return { code, expiresAt };
  }

  /** Consumes a pairing code once and registers a device; returns the raw device token. */
  async registerDevice(code: string, kind: DeviceKind, name: string, capabilities: Record<string, unknown>): Promise<{ device: BridgeDevice; token: string } | null> {
    const codeHash = await sha256Hex(code.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const now = new Date().toISOString();
    const claimed = await this.db
      .prepare('UPDATE bridge_pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
      .bind(now, codeHash, now)
      .first<{ user_id: string }>();
    if (!claimed) return null;

    const token = `shz_${kind === 'desktop' ? 'dsk' : 'brw'}_${randomToken(24)}`;
    const id = `dev_${randomToken(10)}`;
    await this.db
      .prepare('INSERT INTO bridge_devices (id, user_id, kind, name, token_hash, capabilities, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, claimed.user_id, kind, name.slice(0, 80), await sha256Hex(token), JSON.stringify(capabilities), now, now)
      .run();
    const device = (await this.getDevice(claimed.user_id, id))!;
    return { device, token };
  }

  async authenticate(token: string): Promise<BridgeDevice | null> {
    if (!token.startsWith('shz_')) return null;
    const r = await this.db
      .prepare('SELECT * FROM bridge_devices WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(await sha256Hex(token))
      .first<any>();
    return r ? toDevice(r) : null;
  }

  async touch(deviceId: string, capabilities?: Record<string, unknown>): Promise<void> {
    if (capabilities) {
      await this.db.prepare('UPDATE bridge_devices SET last_seen_at = ?, capabilities = ? WHERE id = ?').bind(new Date().toISOString(), JSON.stringify(capabilities), deviceId).run();
    } else {
      await this.db.prepare('UPDATE bridge_devices SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), deviceId).run();
    }
  }

  async getDevice(userId: string, id: string): Promise<BridgeDevice | null> {
    const r = await this.db.prepare('SELECT * FROM bridge_devices WHERE user_id = ? AND id = ? AND revoked_at IS NULL').bind(userId, id).first<any>();
    return r ? toDevice(r) : null;
  }

  async listDevices(userId: string): Promise<BridgeDevice[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM bridge_devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC')
      .bind(userId)
      .all<any>();
    return results.map(toDevice);
  }

  async onlineDevice(userId: string, kind: DeviceKind): Promise<BridgeDevice | null> {
    const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    const r = await this.db
      .prepare('SELECT * FROM bridge_devices WHERE user_id = ? AND kind = ? AND revoked_at IS NULL AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT 1')
      .bind(userId, kind, since)
      .first<any>();
    return r ? toDevice(r) : null;
  }

  async revokeDevice(userId: string, id: string): Promise<boolean> {
    const r = await this.db.prepare('UPDATE bridge_devices SET revoked_at = ? WHERE user_id = ? AND id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), userId, id).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async enqueue(userId: string, deviceId: string, command: string, payload: unknown): Promise<string> {
    const id = `cmd_${randomToken(10)}`;
    await this.db
      .prepare("INSERT INTO bridge_commands (id, user_id, device_id, command, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)")
      .bind(id, userId, deviceId, command, JSON.stringify(payload), new Date().toISOString())
      .run();
    return id;
  }

  /** Atomically hands queued commands to the polling device. */
  async claimForDevice(deviceId: string, limit = 5): Promise<Array<{ id: string; command: string; payload: any }>> {
    const { results } = await this.db
      .prepare(
        `UPDATE bridge_commands SET status = 'running', claimed_at = ?
         WHERE id IN (SELECT id FROM bridge_commands WHERE device_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT ?)
         RETURNING id, command, payload`
      )
      .bind(new Date().toISOString(), deviceId, limit)
      .all<any>();
    return results.map((r) => ({ id: r.id, command: r.command, payload: JSON.parse(r.payload) }));
  }

  async complete(deviceId: string, commandId: string, ok: boolean, result: unknown): Promise<boolean> {
    const r = await this.db
      .prepare("UPDATE bridge_commands SET status = ?, result = ?, completed_at = ? WHERE id = ? AND device_id = ? AND status = 'running'")
      .bind(ok ? 'done' : 'error', JSON.stringify(result ?? null).slice(0, 2_000_000), new Date().toISOString(), commandId, deviceId)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async getResult(commandId: string): Promise<{ status: string; result: any } | null> {
    const r = await this.db.prepare('SELECT status, result FROM bridge_commands WHERE id = ?').bind(commandId).first<any>();
    return r ? { status: r.status, result: r.result ? JSON.parse(r.result) : null } : null;
  }

  async expire(commandId: string): Promise<void> {
    await this.db.prepare("UPDATE bridge_commands SET status = 'expired' WHERE id = ? AND status IN ('queued','running')").bind(commandId).run();
  }
}

export class BridgeOfflineError extends Error {}

/** Sends a command to the user's online device and waits for its result. */
export async function callDevice(
  userId: string,
  kind: DeviceKind,
  command: string,
  payload: unknown,
  opts: { timeoutMs?: number; signal?: AbortSignal; repo?: BridgeRepo } = {}
): Promise<{ ok: boolean; result: any }> {
  const repo = opts.repo || new BridgeRepo();
  const device = await repo.onlineDevice(userId, kind);
  if (!device) {
    throw new BridgeOfflineError(kind === 'desktop'
      ? 'The Shazam desktop app is not connected. Open it and sign in to let the agent use your computer.'
      : 'The Shazam browser extension is not connected. Install it and pair it to let the agent use your browser.');
  }
  const id = await repo.enqueue(userId, device.id, command, payload);
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  let delay = 250;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(1000, delay + 150);
    const r = await repo.getResult(id);
    if (r && (r.status === 'done' || r.status === 'error')) return { ok: r.status === 'done', result: r.result };
  }
  await repo.expire(id);
  throw new Error(`${kind === 'desktop' ? 'Desktop app' : 'Browser extension'} did not respond in time.`);
}
