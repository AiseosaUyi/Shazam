-- Migration: 0008_agent_runs_and_tokens.sql
-- Background agent runs (started from the web UI or from MCP clients like Claude Code,
-- Codex, Antigravity) and personal access tokens for those clients.

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  project_id TEXT,
  parent_run_id TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'queued',
  model TEXT,
  events TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  files_changed TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'tasks',
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_tokens_user ON access_tokens(user_id);
