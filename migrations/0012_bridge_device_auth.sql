-- Migration: 0012_bridge_device_auth.sql
-- Browser device authorization for the bridge (like `gh auth login`): the desktop app or CLI
-- asks for a request, the signed-in user approves it in the browser, and the device collects
-- its token. Both codes are stored only as SHA-256 hashes.

CREATE TABLE IF NOT EXISTS bridge_device_auth (
  device_code_hash TEXT PRIMARY KEY,
  user_code_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '{}',
  requester_ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied | consumed
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  last_poll_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bridge_device_auth_expires ON bridge_device_auth(expires_at);
