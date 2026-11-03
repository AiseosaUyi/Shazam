-- Migration: 0013_run_checkpoints.sql
-- Long agent runs outlive one serverless invocation (~13 min). After every step the run saves
-- its conversation (checkpoint); near the time limit it pauses and a fresh invocation resumes
-- it from the checkpoint. lease_until marks a run as owned by a live invocation, so a run whose
-- invocation died is detected and resumed instead of showing "running" forever.

ALTER TABLE agent_runs ADD COLUMN checkpoint TEXT;
ALTER TABLE agent_runs ADD COLUMN segment INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agent_runs ADD COLUMN lease_until TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_runs_resume ON agent_runs(status, lease_until);
