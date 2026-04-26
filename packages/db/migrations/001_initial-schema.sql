CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_display_name_not_blank CHECK (length(btrim(display_name)) > 0)
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_title_not_blank CHECK (title IS NULL OR length(btrim(title)) > 0)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_role_valid CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  CONSTRAINT messages_content_array CHECK (jsonb_typeof(content) = 'array')
);

CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  app_kind TEXT,
  external_id TEXT,
  title TEXT NOT NULL,
  uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sources_kind_valid CHECK (kind IN ('document', 'web_page', 'email', 'code_repository')),
  CONSTRAINT sources_app_kind_valid CHECK (app_kind IS NULL OR app_kind IN ('github', 'google')),
  CONSTRAINT sources_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE TABLE app_capability_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_kind TEXT NOT NULL,
  capability TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  encrypted_credentials TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}',
  last_sync_cursor TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, app_kind, capability),
  CONSTRAINT app_capability_configs_app_kind_valid CHECK (app_kind IN ('github', 'google')),
  CONSTRAINT app_capability_configs_capability_valid CHECK (capability IN ('knowledge', 'tools')),
  CONSTRAINT app_capability_configs_status_valid CHECK (status IN ('pending', 'connected', 'failed')),
  CONSTRAINT app_capability_configs_last_sync_status_valid
    CHECK (last_sync_status IS NULL OR last_sync_status IN ('pending', 'running', 'completed', 'failed')),
  CONSTRAINT app_capability_configs_settings_object CHECK (jsonb_typeof(settings) = 'object')
);

CREATE TABLE app_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_capability_config_id UUID REFERENCES app_capability_configs(id) ON DELETE SET NULL,
  app_kind TEXT NOT NULL,
  capability TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'running',
  items_discovered INTEGER NOT NULL DEFAULT 0,
  items_queued INTEGER NOT NULL DEFAULT 0,
  items_deleted INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT app_sync_runs_app_kind_valid CHECK (app_kind IN ('github', 'google')),
  CONSTRAINT app_sync_runs_capability_valid CHECK (capability IN ('knowledge', 'tools')),
  CONSTRAINT app_sync_runs_status_valid CHECK (status IN ('running', 'completed', 'failed')),
  CONSTRAINT app_sync_runs_counts_nonnegative
    CHECK (
      items_discovered >= 0
      AND items_queued >= 0
      AND items_deleted >= 0
      AND error_count >= 0
    ),
  CONSTRAINT app_sync_runs_completion_consistent
    CHECK (
      (status = 'running' AND completed_at IS NULL)
      OR (status IN ('completed', 'failed') AND completed_at IS NOT NULL)
    )
);

CREATE TABLE mcp_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_kind TEXT NOT NULL,
  profile_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  encrypted_credentials TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}',
  last_error TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, integration_kind, profile_label),
  CONSTRAINT mcp_profiles_status_valid CHECK (status IN ('pending', 'connected', 'failed')),
  CONSTRAINT mcp_profiles_integration_kind_not_blank CHECK (length(btrim(integration_kind)) > 0),
  CONSTRAINT mcp_profiles_profile_label_not_blank CHECK (length(btrim(profile_label)) > 0),
  CONSTRAINT mcp_profiles_settings_object CHECK (jsonb_typeof(settings) = 'object')
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT documents_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT documents_mime_type_not_blank CHECK (length(btrim(mime_type)) > 0)
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  data BYTEA NOT NULL,
  text_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attachments_kind_valid CHECK (kind IN ('image', 'document', 'audio', 'file')),
  CONSTRAINT attachments_file_name_not_blank CHECK (length(btrim(file_name)) > 0),
  CONSTRAINT attachments_mime_type_not_blank CHECK (length(btrim(mime_type)) > 0),
  CONSTRAINT attachments_size_nonnegative CHECK (size_bytes >= 0)
);

CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  UNIQUE(document_id, chunk_index),
  CONSTRAINT chunks_index_nonnegative CHECK (chunk_index >= 0),
  CONSTRAINT chunks_token_count_nonnegative CHECK (token_count >= 0),
  CONSTRAINT chunks_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  vector vector(1536) NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chunk_id, model),
  CONSTRAINT embeddings_model_not_blank CHECK (length(btrim(model)) > 0)
);

CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);

CREATE TABLE tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  origin TEXT NOT NULL DEFAULT 'native',
  origin_mode TEXT NOT NULL DEFAULT 'text',
  mcp_profile_id UUID REFERENCES mcp_profiles(id) ON DELETE SET NULL,
  integration_kind TEXT,
  approval_id UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT tool_executions_tool_name_not_blank CHECK (length(btrim(tool_name)) > 0),
  CONSTRAINT tool_executions_status_valid
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'requires_approval')),
  CONSTRAINT tool_executions_origin_valid CHECK (origin IN ('native', 'mcp')),
  CONSTRAINT tool_executions_origin_mode_valid CHECK (origin_mode IN ('text', 'voice')),
  CONSTRAINT tool_executions_completion_consistent
    CHECK (
      (status IN ('completed', 'failed') AND completed_at IS NOT NULL)
      OR (status NOT IN ('completed', 'failed') AND completed_at IS NULL)
    )
);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_execution_id UUID NOT NULL REFERENCES tool_executions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT approvals_description_not_blank CHECK (length(btrim(description)) > 0),
  CONSTRAINT approvals_status_valid CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  CONSTRAINT approvals_decision_consistent
    CHECK (
      (status = 'pending' AND decided_at IS NULL)
      OR (status IN ('approved', 'rejected', 'expired') AND decided_at IS NOT NULL)
    )
);

ALTER TABLE tool_executions
  ADD CONSTRAINT tool_executions_approval_id_fkey
  FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE SET NULL;

CREATE TABLE preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, key),
  CONSTRAINT preferences_key_not_blank CHECK (length(btrim(key)) > 0)
);

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'relationship', 'project', 'person', 'instruction')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT memories_content_not_blank CHECK (length(btrim(content)) > 0),
  CONSTRAINT memories_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX idx_conversations_user_updated ON conversations(user_id, updated_at DESC, created_at DESC);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at ASC, id ASC);
CREATE INDEX idx_attachments_user ON attachments(user_id);
CREATE INDEX idx_attachments_message_created ON attachments(message_id, created_at ASC);
CREATE INDEX idx_attachments_document ON attachments(document_id);
CREATE INDEX idx_chunks_document_index ON chunks(document_id, chunk_index ASC);
CREATE INDEX idx_embeddings_chunk ON embeddings(chunk_id);
CREATE INDEX idx_approvals_user_status ON approvals(user_id, status);
CREATE INDEX idx_approvals_tool_execution ON approvals(tool_execution_id);
CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_memories_user_kind_updated ON memories(user_id, kind, updated_at DESC);
CREATE INDEX idx_memories_content_trgm ON memories USING gin (content gin_trgm_ops);
CREATE INDEX idx_tool_executions_conversation_started ON tool_executions(conversation_id, started_at ASC, id ASC);
CREATE INDEX idx_tool_executions_message_started ON tool_executions(message_id, started_at ASC, id ASC);
CREATE INDEX idx_tool_executions_pending_approval
  ON tool_executions(conversation_id, started_at ASC)
  WHERE status = 'requires_approval';
CREATE INDEX idx_tool_executions_approval ON tool_executions(approval_id);
CREATE INDEX idx_sources_user ON sources(user_id);
CREATE INDEX idx_sources_user_app_created ON sources(user_id, app_kind, created_at DESC);
CREATE UNIQUE INDEX idx_sources_app_external
  ON sources(user_id, app_kind, external_id)
  WHERE app_kind IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_documents_user_created ON documents(user_id, created_at DESC);
CREATE UNIQUE INDEX idx_documents_source_unique
  ON documents(source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX idx_app_capability_configs_user ON app_capability_configs(user_id);
CREATE INDEX idx_app_capability_configs_status ON app_capability_configs(status);
CREATE INDEX idx_app_sync_runs_user_kind_started
  ON app_sync_runs(user_id, app_kind, capability, started_at DESC);
CREATE INDEX idx_mcp_profiles_user ON mcp_profiles(user_id);
CREATE INDEX idx_mcp_profiles_user_status ON mcp_profiles(user_id, status, integration_kind);
CREATE UNIQUE INDEX idx_mcp_profiles_default
  ON mcp_profiles(user_id, integration_kind)
  WHERE is_default = TRUE;
