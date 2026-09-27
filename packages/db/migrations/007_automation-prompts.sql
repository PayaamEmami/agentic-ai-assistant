-- Schedules are a prompt plus a cadence. Board, repository, and dry-run
-- columns belonged to the earlier task-board coding job.

ALTER TABLE automation_schedules
  ADD COLUMN prompt TEXT;

UPDATE automation_schedules
SET prompt = name
WHERE prompt IS NULL OR length(btrim(prompt)) = 0;

ALTER TABLE automation_schedules
  ALTER COLUMN prompt SET NOT NULL;

ALTER TABLE automation_schedules
  ADD CONSTRAINT automation_schedules_prompt_not_blank
    CHECK (length(btrim(prompt)) > 0);

ALTER TABLE automation_schedules
  DROP CONSTRAINT automation_schedules_board_id_not_blank;

ALTER TABLE automation_schedules
  DROP CONSTRAINT automation_schedules_repo_allowlist_array;

ALTER TABLE automation_schedules
  DROP COLUMN board_id,
  DROP COLUMN source_list_id,
  DROP COLUMN repo_allowlist,
  DROP COLUMN dry_run;
