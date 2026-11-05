-- How Co-Work handles actions that change things outside Arcwork.
-- ask   = every outward action waits for approval
-- smart = safe actions (to yourself, reversible, read-only) run on their own; the rest ask
-- auto  = everything runs without asking
ALTER TABLE user_preferences ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'smart';
