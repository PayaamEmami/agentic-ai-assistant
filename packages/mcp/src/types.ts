export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface UnifiedToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  origin: 'native' | 'mcp';
  mcpServerId?: string;
  mcpConnectionId?: string;
  integrationKind?: 'playwright';
  instanceLabel?: string;
  requiresApproval: boolean;
}

export interface McpCatalogEntry {
  kind: 'playwright';
  displayName: string;
  description: string;
  supportsMultipleInstances: boolean;
  requiresDefaultActive: boolean;
  authModes: Array<'manual_browser' | 'stored_secret'>;
}

export interface RuntimeMcpConnection {
  id: string;
  userId: string;
  integrationKind: McpCatalogEntry['kind'];
  instanceLabel: string;
  status: 'pending' | 'connected' | 'failed';
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface ToolExecutionInput {
  toolName: string;
  arguments: Record<string, unknown>;
  connection: RuntimeMcpConnection;
}

export interface ToolExecutionOutput {
  success: boolean;
  result: unknown;
  error?: string;
  connectionUpdate?: {
    credentials?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  };
}

export interface ManualAuthSessionStartResult {
  metadata: Record<string, unknown>;
}

export interface ManualAuthSessionCompleteResult {
  metadata?: Record<string, unknown>;
  connectionUpdate?: {
    credentials?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  };
}
