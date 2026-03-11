import type {
  McpServerConfig,
  UnifiedToolDescriptor,
  ToolExecutionInput,
  ToolExecutionOutput,
} from './types.js';

export class McpClient {
  private serverId: string;
  private config: McpServerConfig;

  constructor(config: McpServerConfig) {
    this.serverId = config.id;
    this.config = config;
  }

  async connect(): Promise<void> {
    // TODO: implement MCP client connection using @modelcontextprotocol/sdk
    // For stdio transport: spawn process, create StdioClientTransport
    // For sse transport: create SSE transport with config.url
    void this.config;
  }

  async disconnect(): Promise<void> {
    // TODO: implement graceful disconnect
  }

  async listTools(): Promise<UnifiedToolDescriptor[]> {
    // TODO: call MCP server's tools/list, map to UnifiedToolDescriptor
    return [];
  }

  async executeTool(_input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    // TODO: call MCP server's tools/call
    return { success: false, result: null, error: 'Not implemented' };
  }

  getServerId(): string {
    return this.serverId;
  }

  getConfig(): McpServerConfig {
    return { ...this.config };
  }
}
