CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  kind TEXT NOT NULL,
  app_kind TEXT,
  external_id TEXT,
  title TEXT NOT NULL,
  uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_capability_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
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
  UNIQUE(user_id, app_kind, capability)
);

CREATE TABLE app_sync_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
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
  completed_at TIMESTAMPTZ
);

CREATE TABLE mcp_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  UNIQUE(user_id, integration_kind, profile_label)
);

CREATE TABLE browser_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mcp_profile_id UUID NOT NULL REFERENCES mcp_profiles(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending',
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  tool_execution_id UUID,
  selected_page_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  owner_api_instance_id TEXT,
  owner_api_instance_url TEXT,
  last_client_seen_at TIMESTAMPTZ,
  last_frame_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  source_id UUID REFERENCES sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id),
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  data BYTEA NOT NULL,
  text_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chunk_id UUID NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  vector vector(1536),
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = 100);

CREATE TABLE tool_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  origin TEXT NOT NULL DEFAULT 'native',
  mcp_profile_id UUID REFERENCES mcp_profiles(id) ON DELETE SET NULL,
  integration_kind TEXT,
  approval_id UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_execution_id UUID NOT NULL REFERENCES tool_executions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'relationship', 'project', 'person', 'instruction')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_attachments_user ON attachments(user_id);
CREATE INDEX idx_attachments_message ON attachments(message_id);
CREATE INDEX idx_attachments_document ON attachments(document_id);
CREATE INDEX idx_chunks_document ON chunks(document_id);
CREATE INDEX idx_embeddings_chunk ON embeddings(chunk_id);
CREATE INDEX idx_approvals_user_status ON approvals(user_id, status);
CREATE INDEX idx_memories_user ON memories(user_id);
CREATE INDEX idx_memories_user_kind_updated ON memories(user_id, kind, updated_at DESC);
CREATE INDEX idx_tool_executions_conversation ON tool_executions(conversation_id);
CREATE INDEX idx_sources_user ON sources(user_id);
CREATE UNIQUE INDEX idx_sources_app_external
  ON sources(user_id, app_kind, external_id)
  WHERE app_kind IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_documents_user ON documents(user_id);
CREATE UNIQUE INDEX idx_documents_source_unique
  ON documents(source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX idx_app_capability_configs_user ON app_capability_configs(user_id);
CREATE INDEX idx_app_sync_runs_user_kind_started
  ON app_sync_runs(user_id, app_kind, capability, started_at DESC);
CREATE INDEX idx_mcp_profiles_user ON mcp_profiles(user_id);
CREATE INDEX idx_browser_sessions_profile
  ON browser_sessions(mcp_profile_id, created_at DESC);
CREATE INDEX idx_browser_sessions_user_status_updated
  ON browser_sessions(user_id, status, updated_at DESC);
CREATE INDEX idx_browser_sessions_message
  ON browser_sessions(message_id);
CREATE INDEX idx_browser_sessions_owner_status
  ON browser_sessions(owner_api_instance_id, status);
CREATE UNIQUE INDEX idx_browser_sessions_active_profile
  ON browser_sessions(mcp_profile_id)
  WHERE status IN ('pending', 'active');
CREATE UNIQUE INDEX idx_mcp_profiles_default
  ON mcp_profiles(user_id, integration_kind)
  WHERE is_default = TRUE;
