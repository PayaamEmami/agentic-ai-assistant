-- Heartbeat column so a live coding job is not failed as stale just because
-- it has been running a long time. The sweeper times out running rows from
-- updated_at, which every stage/progress write refreshes.

ALTER TABLE automation_runs
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
