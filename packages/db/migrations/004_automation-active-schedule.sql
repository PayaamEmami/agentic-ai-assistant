-- At most one in-flight run per schedule, so Run now and the cron tick cannot
-- both enqueue work for the same automation. Duplicate active rows from before
-- this constraint are failed first so the index can be created.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY schedule_id
           ORDER BY started_at DESC
         ) AS rn
  FROM automation_runs
  WHERE schedule_id IS NOT NULL
    AND status IN ('queued', 'running')
)
UPDATE automation_runs
SET status = 'failed',
    current_stage = NULL,
    error = 'Superseded by a newer in-flight run for the same schedule.',
    completed_at = NOW()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX idx_automation_runs_active_schedule
  ON automation_runs (schedule_id)
  WHERE schedule_id IS NOT NULL AND status IN ('queued', 'running');
