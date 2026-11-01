-- Migration: 0011_waitlist.sql
-- Early-access list. While Google OAuth is in testing mode only approved emails can connect
-- Gmail & Calendar; the admin adds them as Google test users, then marks them invited here.

CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  use_case TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'declined')),
  created_at TEXT NOT NULL,
  invited_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status, created_at);
