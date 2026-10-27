-- Migration: 0005_skills.sql
-- Adds skills table for autonomous Co-Work agents (Gmail, Chrome/Social, Notion MCP, Video Editor, etc.)

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  instructions TEXT NOT NULL,
  tools TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id, updated_at DESC);
