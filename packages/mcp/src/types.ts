export interface UnifiedToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  origin: 'native' | 'mcp';
  mcpServerId?: string;
  mcpProfileId?: string;
  integrationKind?: 'playwright';
  profileLabel?: string;
  requiresApproval: boolean;
}

export interface McpCatalogEntry {
  kind: 'playwright';
  displayName: string;
  description: string;
  supportsMultipleProfiles: boolean;
  requiresDefaultProfile: boolean;
  authModes: Array<'embedded_browser' | 'stored_secret'>;
}

export interface RuntimeMcpProfile {
  id: string;
  userId: string;
  integrationKind: McpCatalogEntry['kind'];
  profileLabel: string;
  status: 'pending' | 'connected' | 'failed';
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface ToolExecutionInput {
  toolName: string;
  arguments: Record<string, unknown>;
  profile: RuntimeMcpProfile;
}

export interface ToolExecutionOutput {
  success: boolean;
  result: unknown;
  error?: string;
  profileUpdate?: {
    credentials?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  };
}
