-- MCP app connections plus scheduled board automation.

-- An MCP server is connected like any other app, so it reuses
-- app_capability_configs: server URL in settings, API key in
-- encrypted_credentials. Note UNIQUE(user_id, app_kind, capability) means one
-- MCP server per user for now.
ALTER TABLE app_capability_configs
  DROP CONSTRAINT app_capability_configs_app_kind_valid;

ALTER TABLE app_capability_configs
  ADD CONSTRAINT app_capability_configs_app_kind_valid
    CHECK (app_kind IN ('github', 'google', 'mcp'));

-- Each automation run gets a conversation so it can reuse message persistence
-- and WebSocket streaming, but those conversations are hidden from the sidebar.
ALTER TABLE conversations
  ADD COLUMN is_automation BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE automation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled BOOLEAN NOT NULL DEFAULT true,
  board_id TEXT NOT NULL,
  source_list_id TEXT,
  -- NULL means every repository the GitHub connection can reach.
  repo_allowlist JSONB,
  dry_run BOOLEAN NOT NULL DEFAULT true,
  max_runs_per_day INTEGER NOT NULL DEFAULT 1,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_schedules_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT automation_schedules_cron_not_blank CHECK (length(btrim(cron)) > 0),
  CONSTRAINT automation_schedules_board_id_not_blank CHECK (length(btrim(board_id)) > 0),
  CONSTRAINT automation_schedules_max_runs_positive CHECK (max_runs_per_day > 0),
  CONSTRAINT automation_schedules_repo_allowlist_array
    CHECK (repo_allowlist IS NULL OR jsonb_typeof(repo_allowlist) = 'array')
);

CREATE TABLE automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES automation_schedules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  current_stage TEXT,
  trigger TEXT NOT NULL DEFAULT 'schedule',
  dry_run BOOLEAN NOT NULL DEFAULT false,
  board_id TEXT,
  selected_card_id TEXT,
  selected_card_title TEXT,
  selected_repo TEXT,
  rationale TEXT,
  pull_request_url TEXT,
  skip_reason TEXT,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT automation_runs_status_valid
    CHECK (status IN ('queued', 'running', 'completed', 'skipped', 'failed')),
  CONSTRAINT automation_runs_trigger_valid CHECK (trigger IN ('schedule', 'manual')),
  CONSTRAINT automation_runs_completion_consistent
    CHECK (
      (status IN ('queued', 'running') AND completed_at IS NULL)
      OR (status IN ('completed', 'skipped', 'failed') AND completed_at IS NOT NULL)
    )
);

-- Append-only activity log. tool_executions only keeps the newest progress
-- message, so without this table the step-by-step timeline of a run is lost and
-- could not be replayed after a page reload.
CREATE TABLE automation_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind TEXT NOT NULL,
  stage TEXT,
  phase TEXT,
  message TEXT NOT NULL,
  CONSTRAINT automation_run_events_kind_valid
    CHECK (kind IN ('stage', 'thought', 'progress', 'result')),
  CONSTRAINT automation_run_events_seq_positive CHECK (seq > 0),
  UNIQUE (run_id, seq)
);

CREATE INDEX idx_automation_schedules_user ON automation_schedules(user_id);
CREATE INDEX idx_automation_schedules_due
  ON automation_schedules(next_run_at)
  WHERE enabled;
CREATE INDEX idx_automation_runs_user_started
  ON automation_runs(user_id, started_at DESC);
CREATE INDEX idx_automation_runs_schedule_started
  ON automation_runs(schedule_id, started_at DESC);
-- Backs the idempotency check that skips cards with an automation PR already open.
CREATE INDEX idx_automation_runs_card
  ON automation_runs(user_id, selected_card_id)
  WHERE selected_card_id IS NOT NULL;
CREATE INDEX idx_automation_run_events_run_seq ON automation_run_events(run_id, seq);
-- The sidebar lists only real conversations, so index the ones it reads.
CREATE INDEX idx_conversations_user_updated_not_automation
  ON conversations(user_id, updated_at DESC)
  WHERE NOT is_automation;
