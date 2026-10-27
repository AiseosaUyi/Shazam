-- Migration: 0002_projects_and_ide.sql
-- Adds projects table and project_id relations for IDE workspace

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  root_dir TEXT NOT NULL DEFAULT '/',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);

-- Alter workspace_files, workspace_proposals, and workspace_checkpoints to add project_id
ALTER TABLE workspace_files ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_workspace_files_project ON workspace_files(project_id, path);

ALTER TABLE workspace_proposals ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_proposals_project ON workspace_proposals(project_id, created_at DESC);

ALTER TABLE workspace_checkpoints ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON workspace_checkpoints(project_id, created_at DESC);
