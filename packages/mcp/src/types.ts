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
  requiresApproval: boolean;
}

export interface ToolExecutionInput {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionOutput {
  success: boolean;
  result: unknown;
  error?: string;
}
