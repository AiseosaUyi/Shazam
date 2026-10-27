-- Shazam AI schema (Cloudflare D1 / SQLite)
-- All tenant data carries user_id and every query in src/lib/db/repo.ts filters on it.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  onboarded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- SHA-256 of the session token; the raw token only lives in the cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_cost_policy TEXT NOT NULL DEFAULT 'balanced',
  max_cost_per_task_usd REAL NOT NULL DEFAULT 0.25,
  monthly_budget_usd REAL NOT NULL DEFAULT 10,
  privacy_mode TEXT NOT NULL DEFAULT 'standard',
  retention_days INTEGER NOT NULL DEFAULT 90,
  allowed_providers TEXT,            -- JSON array or NULL (= all)
  preferred_region TEXT,
  auto_fallback_enabled INTEGER NOT NULL DEFAULT 1,
  allow_paid_fallback INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE provider_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'invalid', 'untested')),
  created_at TEXT NOT NULL,
  last_validated_at TEXT,
  UNIQUE (user_id, provider_id)
);

-- Admin kill switches layered over the versioned catalogue in code.
CREATE TABLE catalog_overrides (
  target_type TEXT NOT NULL CHECK (target_type IN ('provider', 'route')),
  target_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  reason TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id)
);

-- Cached dynamic catalogue data (e.g. OpenRouter free models).
CREATE TABLE catalog_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

-- Route health and cooldowns. scope = 'global' for shared/system routes, or a user id for that user's own key.
CREATE TABLE route_health (
  route_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  cooldown_until TEXT,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  ewma_latency_ms REAL,
  last_error_type TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (route_id, scope)
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  reasoning TEXT,
  task_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT,
  status TEXT NOT NULL,
  task_class TEXT NOT NULL,
  cost_policy TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  reasoning TEXT,
  route_id TEXT,
  model_id TEXT,
  provider_id TEXT,
  decision_trace TEXT,               -- JSON
  attempts TEXT NOT NULL DEFAULT '[]', -- JSON
  cost_usd REAL NOT NULL DEFAULT 0,
  cost_kind TEXT NOT NULL DEFAULT 'estimated',
  error TEXT,                        -- JSON (normalized, user-safe)
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_tasks_user ON tasks(user_id, created_at DESC);

-- Append-only usage ledger.
CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  task_class TEXT NOT NULL,
  cost_policy TEXT NOT NULL,
  cost_class TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  cost_kind TEXT NOT NULL,           -- 'estimated' | 'unknown' | 'zero'
  tokens_kind TEXT NOT NULL,         -- 'provider_reported' | 'estimated'
  status TEXT NOT NULL,              -- 'succeeded' | 'failed' | 'cancelled'
  error_type TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_usage_user_time ON usage_events(user_id, created_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_time ON audit_events(created_at DESC);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  comment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, task_id)
);

-- Coding workspace: per-user files, edits are proposals that need approval.
CREATE TABLE workspace_files (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, path)
);

CREATE TABLE workspace_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instruction TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes TEXT NOT NULL,             -- JSON [{path, action, content}]
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
  task_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX idx_proposals_user ON workspace_proposals(user_id, created_at DESC);

CREATE TABLE workspace_checkpoints (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  files TEXT NOT NULL,               -- JSON {path: content}
  created_at TEXT NOT NULL
);
