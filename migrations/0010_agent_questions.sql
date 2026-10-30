-- Migration: 0010_agent_questions.sql
-- Agents can pause and ask the user a question (with options); the answer resumes the task.

CREATE TABLE IF NOT EXISTS agent_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT,
  question TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  answer TEXT,
  created_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_questions_run ON agent_questions(run_id);
