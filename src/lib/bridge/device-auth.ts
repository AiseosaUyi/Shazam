import { getDb } from '@/lib/env';
import type { SqlDatabase } from '@/lib/db/sql';
import { BridgeRepo, randomToken, sha256Hex, type BridgeDevice, type DeviceKind } from './repo';

/**
 * Browser device authorization for the bridge (RFC 8628 style, like `gh auth login`).
 *
 *   1. The desktop app / CLI calls start() and gets a secret device code plus a short user code.
 *   2. It opens /connect?code=USER-CODE; the signed-in user checks the code and clicks Approve.
 *   3. The device polls with its device code and collects a normal device token, once.
 *
 * Only hashes of both codes are stored. A request lives 10 minutes and can be used once.
 */

export const DEVICE_AUTH_TTL_MS = 10 * 60_000;
export const DEVICE_AUTH_INTERVAL_S = 3;
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ2456789'; // no vowels (no words), no 0/O/1/I

export type DeviceAuthPoll =
  | { status: 'pending' | 'slow_down' | 'denied' | 'expired' }
  | { status: 'approved'; token: string; device: BridgeDevice; accountEmail: string | null };

export interface DeviceAuthRequest {
  kind: DeviceKind;
  name: string;
  platform: string | null;
  createdAt: string;
  expiresAt: string;
  /** False when the approver is on a different network than the computer that asked. */
  sameNetwork: boolean | null;
}

/** Strips separators and case so "abcd-efgh", "ABCD EFGH" and "ABCDEFGH" match. */
export function normalizeUserCode(code: string): string {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

export class DeviceAuthRepo {
  constructor(private db: SqlDatabase = getDb()) {}

  async start(input: { kind: DeviceKind; name: string; capabilities: Record<string, unknown>; requesterIp: string }): Promise<{ deviceCode: string; userCode: string; expiresAt: string; interval: number }> {
    const now = new Date();
    // Keep the table small: drop requests that expired more than a day ago.
    await this.db.prepare('DELETE FROM bridge_device_auth WHERE expires_at < ?').bind(new Date(now.getTime() - 86_400_000).toISOString()).run();

    const deviceCode = `shz_dac_${randomToken(32)}`;
    const raw = crypto.getRandomValues(new Uint8Array(8));
    // 27^8 ≈ 2.8e11 codes; modulo bias is negligible at this size and the code is not the secret.
    const userCode = Array.from(raw).map((b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]).join('');
    const expiresAt = new Date(now.getTime() + DEVICE_AUTH_TTL_MS).toISOString();
    await this.db
      .prepare(
        `INSERT INTO bridge_device_auth (device_code_hash, user_code_hash, kind, name, capabilities, requester_ip_hash, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(await sha256Hex(deviceCode), await sha256Hex(userCode), input.kind, input.name.slice(0, 80), JSON.stringify(input.capabilities || {}), await sha256Hex(`ip:${input.requesterIp}`), now.toISOString(), expiresAt)
      .run();
    return { deviceCode, userCode: `${userCode.slice(0, 4)}-${userCode.slice(4)}`, expiresAt, interval: DEVICE_AUTH_INTERVAL_S };
  }

  /** What the approval page shows. Only pending, unexpired requests are visible. */
  async lookup(userCode: string, approverIp?: string): Promise<DeviceAuthRequest | null> {
    const code = normalizeUserCode(userCode);
    if (code.length !== 8) return null;
    const r = await this.db
      .prepare("SELECT * FROM bridge_device_auth WHERE user_code_hash = ? AND status = 'pending' AND expires_at > ?")
      .bind(await sha256Hex(code), new Date().toISOString())
      .first<any>();
    if (!r) return null;
    const caps = JSON.parse(r.capabilities || '{}');
    return {
      kind: r.kind,
      name: r.name,
      platform: typeof caps.platform === 'string' ? caps.platform : null,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      sameNetwork: approverIp && r.requester_ip_hash ? r.requester_ip_hash === (await sha256Hex(`ip:${approverIp}`)) : null,
    };
  }

  /** The signed-in user approves or denies a pending request. Returns false if it is gone. */
  async decide(userId: string, userCode: string, approve: boolean): Promise<boolean> {
    const code = normalizeUserCode(userCode);
    if (code.length !== 8) return false;
    const now = new Date().toISOString();
    const r = await this.db
      .prepare("UPDATE bridge_device_auth SET status = ?, user_id = ?, decided_at = ? WHERE user_code_hash = ? AND status = 'pending' AND expires_at > ?")
      .bind(approve ? 'approved' : 'denied', userId, now, await sha256Hex(code), now)
      .run();
    return (r.meta?.changes ?? 0) > 0;
  }

  /** The device collects its token. An approved request hands out exactly one token. */
  async poll(deviceCode: string, bridge = new BridgeRepo(this.db)): Promise<DeviceAuthPoll> {
    if (typeof deviceCode !== 'string' || !deviceCode.startsWith('shz_dac_')) return { status: 'expired' };
    const hash = await sha256Hex(deviceCode);
    const now = new Date();
    const r = await this.db.prepare('SELECT status, expires_at, last_poll_at FROM bridge_device_auth WHERE device_code_hash = ?').bind(hash).first<any>();
    if (!r || r.status === 'consumed') return { status: 'expired' };
    if (r.status === 'denied') return { status: 'denied' };
    if (r.expires_at <= now.toISOString()) return { status: 'expired' }; // approved but never collected expires too

    const tooFast = r.last_poll_at && now.getTime() - new Date(r.last_poll_at).getTime() < (DEVICE_AUTH_INTERVAL_S - 1) * 1000;
    await this.db.prepare('UPDATE bridge_device_auth SET last_poll_at = ? WHERE device_code_hash = ?').bind(now.toISOString(), hash).run();
    if (r.status === 'pending') return { status: tooFast ? 'slow_down' : 'pending' };

    // Approved: claim it atomically so two concurrent polls cannot both get a token.
    const claimed = await this.db
      .prepare("UPDATE bridge_device_auth SET status = 'consumed' WHERE device_code_hash = ? AND status = 'approved' RETURNING user_id, kind, name, capabilities")
      .bind(hash)
      .first<any>();
    if (!claimed?.user_id) return { status: 'expired' };
    const { device, token } = await bridge.issueDevice(claimed.user_id, claimed.kind, claimed.name, JSON.parse(claimed.capabilities || '{}'));
    const user = await this.db.prepare('SELECT email FROM users WHERE id = ?').bind(claimed.user_id).first<{ email: string }>();
    return { status: 'approved', token, device, accountEmail: user?.email ?? null };
  }
}
