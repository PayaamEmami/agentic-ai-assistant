import { McpClient } from './mcp-client.js';
import type {
  McpServerConfig,
  UnifiedToolDescriptor,
  ToolExecutionInput,
  ToolExecutionOutput,
} from './types.js';

export type NativeToolHandler = (
  args: Record<string, unknown>,
) => Promise<ToolExecutionOutput>;

interface ToolEntry {
  descriptor: UnifiedToolDescriptor;
  mcpServerId: string | undefined;
}

export class ToolRegistry {
  private mcpClients: Map<string, McpClient> = new Map();
  private nativeTools: Map<string, NativeToolHandler> = new Map();
  private toolIndex: Map<string, ToolEntry> = new Map();

  async registerMcpServer(config: McpServerConfig): Promise<void> {
    const client = new McpClient(config);
    await client.connect();
    this.mcpClients.set(config.id, client);

    const tools = await client.listTools();
    for (const tool of tools) {
      this.toolIndex.set(tool.name, { descriptor: tool, mcpServerId: config.id });
    }
  }

  registerNativeTool(
    descriptor: UnifiedToolDescriptor,
    handler: NativeToolHandler,
  ): void {
    this.nativeTools.set(descriptor.name, handler);
    this.toolIndex.set(descriptor.name, {
      descriptor,
      mcpServerId: undefined,
    });
  }

  listTools(): UnifiedToolDescriptor[] {
    return Array.from(this.toolIndex.values()).map((e) => e.descriptor);
  }

  async executeTool(input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    const entry = this.toolIndex.get(input.toolName);
    if (!entry) {
      return { success: false, result: null, error: `Unknown tool: ${input.toolName}` };
    }

    if (entry.descriptor.origin === 'native') {
      const handler = this.nativeTools.get(input.toolName);
      if (!handler) {
        return { success: false, result: null, error: `Native handler not found: ${input.toolName}` };
      }
      return handler(input.arguments);
    }

    if (entry.mcpServerId) {
      const client = this.mcpClients.get(entry.mcpServerId);
      if (!client) {
        return { success: false, result: null, error: `MCP server not connected: ${entry.mcpServerId}` };
      }
      return client.executeTool(input);
    }

    return { success: false, result: null, error: `No handler for tool: ${input.toolName}` };
  }

  async shutdown(): Promise<void> {
    for (const client of this.mcpClients.values()) {
      await client.disconnect();
    }
    this.mcpClients.clear();
    this.toolIndex.clear();
  }
}
