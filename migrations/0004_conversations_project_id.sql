-- Migration: 0004_conversations_project_id.sql
-- Strictly scopes conversations to projects for true project tenancy isolation (Antigravity standard)

ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, updated_at DESC);
