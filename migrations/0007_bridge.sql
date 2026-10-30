-- Migration: 0007_bridge.sql
-- Outbound device bridge: the desktop app and the browser extension connect TO Shazam and
-- pull commands, so the cloud agents can act on the user's machine without inbound access.

CREATE TABLE IF NOT EXISTS bridge_pairing_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS bridge_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  capabilities TEXT NOT NULL DEFAULT '{}',
  last_seen_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bridge_devices_user ON bridge_devices(user_id, kind);

CREATE TABLE IF NOT EXISTS bridge_commands (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES bridge_devices(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bridge_cmd_device ON bridge_commands(device_id, status, created_at);
