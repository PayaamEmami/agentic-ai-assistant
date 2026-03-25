import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getLogger } from '@aaa/observability';
import type {
  McpServerConfig,
  UnifiedToolDescriptor,
  ToolExecutionInput,
  ToolExecutionOutput,
} from './types.js';

export class McpClient {
  private serverId: string;
  private config: McpServerConfig;
  private client: Client | null = null;

  constructor(config: McpServerConfig) {
    this.serverId = config.id;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }
    const logger = getLogger({
      component: 'mcp-client',
      mcpServerId: this.serverId,
    });

    const client = new Client(
      {
        name: 'agentic-ai-assistant',
        version: '0.0.1',
      },
      {
        capabilities: {},
      },
    );

    client.onerror = () => {
      this.client = null;
      logger.warn(
        {
          event: 'mcp.connection.error',
          outcome: 'failure',
        },
        'MCP client encountered an error',
      );
    };
    client.onclose = () => {
      this.client = null;
      logger.info(
        {
          event: 'mcp.connection.closed',
          outcome: 'success',
        },
        'MCP client connection closed',
      );
    };

    await client.connect(this.createTransport());
    this.client = client;
    logger.info(
      {
        event: 'mcp.connection.opened',
        outcome: 'success',
      },
      'MCP client connected',
    );
  }

  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = null;
    await client.close();
  }

  async listTools(): Promise<UnifiedToolDescriptor[]> {
    const client = await this.getClient();
    const logger = getLogger({
      component: 'mcp-client',
      mcpServerId: this.serverId,
    });
    const tools: UnifiedToolDescriptor[] = [];
    let cursor: string | undefined;

    do {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...result.tools.map((tool) => this.toUnifiedToolDescriptor(tool)));
      cursor = result.nextCursor;
    } while (cursor);

    logger.info(
      {
        event: 'mcp.tools.listed',
        outcome: 'success',
        toolCount: tools.length,
      },
      'MCP tools listed',
    );
    return tools;
  }

  async executeTool(input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    const logger = getLogger({
      component: 'mcp-client',
      mcpServerId: this.serverId,
    });
    try {
      const client = await this.getClient();
      const result = await client.callTool({
        name: input.toolName,
        arguments: input.arguments,
      });

      const normalized = normalizeCallToolResult(result);
      if (result.isError) {
        logger.warn(
          {
            event: 'mcp.tool.completed',
            outcome: 'failure',
            toolName: input.toolName,
          },
          'MCP tool returned an error result',
        );
        return {
          success: false,
          result: normalized,
          error: extractCallToolError(result, input.toolName),
        };
      }

      logger.info(
        {
          event: 'mcp.tool.completed',
          outcome: 'success',
          toolName: input.toolName,
        },
        'MCP tool executed successfully',
      );
      return {
        success: true,
        result: normalized,
      };
    } catch (error) {
      logger.error(
        {
          event: 'mcp.tool.completed',
          outcome: 'failure',
          toolName: input.toolName,
          error,
        },
        'MCP tool execution failed',
      );
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getServerId(): string {
    return this.serverId;
  }

  getConfig(): McpServerConfig {
    return { ...this.config };
  }

  private async getClient(): Promise<Client> {
    if (!this.client) {
      await this.connect();
    }

    if (!this.client) {
      throw new Error(`MCP client is not connected: ${this.serverId}`);
    }

    return this.client;
  }

  private createTransport() {
    if (this.config.transport === 'stdio') {
      if (!this.config.command) {
        throw new Error(`MCP stdio server "${this.serverId}" is missing a command`);
      }

      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: this.config.env,
      });
    }

    if (!this.config.url) {
      throw new Error(`MCP SSE server "${this.serverId}" is missing a URL`);
    }

    return new SSEClientTransport(new URL(this.config.url));
  }

  private toUnifiedToolDescriptor(tool: Awaited<ReturnType<Client['listTools']>>['tools'][number]): UnifiedToolDescriptor {
    return {
      name: tool.name,
      description: tool.description ?? tool.title ?? `MCP tool from ${this.config.name}`,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      origin: 'mcp',
      mcpServerId: this.serverId,
      requiresApproval: inferApprovalRequirement(tool),
    };
  }
}

function inferApprovalRequirement(
  tool: Awaited<ReturnType<Client['listTools']>>['tools'][number],
): boolean {
  const annotations = tool.annotations;
  if (!annotations) {
    return true;
  }

  if (annotations.readOnlyHint === true && annotations.destructiveHint !== true) {
    return false;
  }

  return annotations.destructiveHint === true || annotations.openWorldHint === true || annotations.readOnlyHint !== true;
}

function normalizeCallToolResult(
  result: Awaited<ReturnType<Client['callTool']>>,
): unknown {
  const hasStructuredContent =
    'structuredContent' in result && typeof result.structuredContent !== 'undefined';
  const structuredContent = hasStructuredContent ? result.structuredContent : undefined;
  const content = Array.isArray(result.content)
    ? result.content.map((block) => normalizeContentBlock(block))
    : [];

  if (typeof structuredContent !== 'undefined' && content.length === 0) {
    return structuredContent;
  }

  if (typeof structuredContent !== 'undefined') {
    return {
      structuredContent,
      content,
    };
  }

  if (content.length === 1 && isRecord(content[0]) && content[0].type === 'text') {
    return { text: content[0].text };
  }

  return { content };
}

function extractCallToolError(
  result: Awaited<ReturnType<Client['callTool']>>,
  toolName: string,
): string {
  const textBlocks = Array.isArray(result.content)
    ? result.content
        .filter((block): block is Extract<(typeof result.content)[number], { type: 'text' }> => block.type === 'text')
        .map((block) => block.text.trim())
        .filter((text) => text.length > 0)
    : [];

  return textBlocks[0] ?? `MCP tool "${toolName}" returned an error`;
}

function normalizeContentBlock(block: unknown): Record<string, unknown> {
  if (!isRecord(block) || typeof block.type !== 'string') {
    return { type: 'unknown', value: block };
  }

  switch (block.type) {
    case 'text':
      return { type: 'text', text: typeof block.text === 'string' ? block.text : '' };
    case 'image':
      return {
        type: 'image',
        mimeType: typeof block.mimeType === 'string' ? block.mimeType : null,
        data: typeof block.data === 'string' ? block.data : null,
      };
    case 'audio':
      return {
        type: 'audio',
        mimeType: typeof block.mimeType === 'string' ? block.mimeType : null,
        data: typeof block.data === 'string' ? block.data : null,
      };
    case 'resource':
      return { type: 'resource', resource: 'resource' in block ? block.resource : null };
    case 'resource_link':
      return {
        type: 'resource_link',
        name: typeof block.name === 'string' ? block.name : null,
        uri: typeof block.uri === 'string' ? block.uri : null,
      };
    default:
      return { type: block.type, value: block };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
