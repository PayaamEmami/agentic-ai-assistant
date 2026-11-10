-- A coding run stays open after the worker hands the task to a coding-agent
-- provider. The poller completes it when that provider reports a terminal result.

CREATE TABLE coding_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_execution_id UUID NOT NULL UNIQUE REFERENCES tool_executions(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  external_id TEXT NOT NULL UNIQUE,
  repo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  branch TEXT,
  pull_request_url TEXT,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT coding_runs_status_valid CHECK (status IN ('running', 'finished', 'error')),
  CONSTRAINT coding_runs_provider_not_blank CHECK (length(btrim(provider_id)) > 0),
  CONSTRAINT coding_runs_external_not_blank CHECK (length(btrim(external_id)) > 0),
  CONSTRAINT coding_runs_repo_not_blank CHECK (length(btrim(repo)) > 0),
  CONSTRAINT coding_runs_correlation_not_blank CHECK (length(btrim(correlation_id)) > 0)
);

CREATE INDEX idx_coding_runs_running
  ON coding_runs (created_at ASC)
  WHERE status = 'running';
