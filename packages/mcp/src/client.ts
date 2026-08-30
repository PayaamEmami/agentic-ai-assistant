import { fetchWithTelemetry } from '@aaa/observability';
import {
  McpError,
  McpToolError,
  type McpClientOptions,
  type McpContentBlock,
  type McpInitializeResult,
  type McpToolCallResult,
  type McpToolDefinition,
} from './types.js';
import { assertPublicHttpsUrl } from './url.js';

const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CLIENT_NAME = 'agentic-ai-assistant';
const DEFAULT_CLIENT_VERSION = '1.0.0';

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Minimal MCP client speaking JSON-RPC 2.0 over the stateless Streamable HTTP
 * transport: one POST per request, bearer-token authenticated.
 *
 * Stateless by design, matching the Lambda-backed servers it talks to, so there
 * is no session id to track and `initialize` is only a capability handshake.
 */
export class McpClient {
  private readonly serverUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly protocolVersion: string;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private requestId = 0;

  constructor(options: McpClientOptions) {
    this.serverUrl = assertPublicHttpsUrl(options.serverUrl);

    if (!options.apiKey) {
      throw new McpError('An MCP API key is required');
    }
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.clientName = options.clientName ?? DEFAULT_CLIENT_NAME;
    this.clientVersion = options.clientVersion ?? DEFAULT_CLIENT_VERSION;
  }

  async initialize(): Promise<McpInitializeResult> {
    const result = await this.request('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: this.clientName, version: this.clientVersion },
    });

    if (!isRecord(result)) {
      throw new McpError('MCP server returned a malformed initialize result');
    }

    const serverInfo = isRecord(result.serverInfo) ? result.serverInfo : {};

    return {
      protocolVersion:
        typeof result.protocolVersion === 'string'
          ? result.protocolVersion
          : this.protocolVersion,
      capabilities: isRecord(result.capabilities) ? result.capabilities : {},
      serverInfo: {
        name: typeof serverInfo.name === 'string' ? serverInfo.name : 'unknown',
        version: typeof serverInfo.version === 'string' ? serverInfo.version : '0.0.0',
      },
    };
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.request('tools/list', {});

    if (!isRecord(result) || !Array.isArray(result.tools)) {
      throw new McpError('MCP server returned a malformed tools list');
    }

    return result.tools.filter(isRecord).flatMap((tool) => {
      if (typeof tool.name !== 'string' || !tool.name) {
        return [];
      }

      return [
        {
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description : '',
          inputSchema: isRecord(tool.inputSchema)
            ? tool.inputSchema
            : { type: 'object', properties: {} },
        },
      ];
    });
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<McpToolCallResult> {
    const result = await this.request('tools/call', { name, arguments: args });

    if (!isRecord(result)) {
      throw new McpError(`MCP tool "${name}" returned a malformed result`);
    }

    const content: McpContentBlock[] = Array.isArray(result.content)
      ? result.content.filter(isRecord).map((block) => ({
          type: typeof block.type === 'string' ? block.type : 'text',
          ...(typeof block.text === 'string' ? { text: block.text } : {}),
        }))
      : [];

    const isError = result.isError === true;
    const data = parseFirstJsonBlock(content);

    if (isError) {
      throw new McpToolError(extractToolErrorMessage(data, content, name), name);
    }

    return { content, isError, ...(data === undefined ? {} : { data }) };
  }

  /** Verify the server is reachable and the key works, returning its tools. */
  async testConnection(): Promise<{
    serverInfo: McpInitializeResult['serverInfo'];
    tools: McpToolDefinition[];
  }> {
    const { serverInfo } = await this.initialize();
    const tools = await this.listTools();
    return { serverInfo, tools };
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    this.requestId += 1;
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: this.requestId,
      method,
      params,
    });

    let response: Response;
    try {
      response = await fetchWithTelemetry(
        this.serverUrl,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': this.protocolVersion,
          },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
        },
        {
          component: 'mcp-client',
          provider: 'mcp',
          eventPrefix: 'mcp.request',
          logResponseBodyOnFailure: false,
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new McpError(`MCP request "${method}" timed out`);
      }

      throw new McpError(
        `Could not reach the MCP server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new McpError(
        'The MCP server rejected the API key',
        undefined,
        response.status,
      );
    }

    const text = await response.text();

    // A notification-style 202 has no body and no result to unwrap.
    if (response.status === 202 && !text) {
      return {};
    }

    if (!response.ok && !text) {
      throw new McpError(
        `MCP server returned HTTP ${response.status}`,
        undefined,
        response.status,
      );
    }

    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(text) as JsonRpcResponse;
    } catch {
      throw new McpError(
        `MCP server returned a non-JSON response (HTTP ${response.status})`,
        undefined,
        response.status,
      );
    }

    if (parsed.error) {
      throw new McpError(
        parsed.error.message ?? `MCP request "${method}" failed`,
        parsed.error.code,
        response.status,
      );
    }

    if (!response.ok) {
      throw new McpError(
        `MCP server returned HTTP ${response.status}`,
        undefined,
        response.status,
      );
    }

    return parsed.result;
  }
}

/**
 * Tool handlers and jobs want the structured payload, not the MCP content-block
 * wrapper. Falls back to the raw blocks when the server returned plain text.
 */
export function unwrapMcpToolData(result: McpToolCallResult): unknown {
  return result.data !== undefined ? result.data : result.content;
}

function parseFirstJsonBlock(content: McpContentBlock[]): unknown {
  for (const block of content) {
    if (block.type !== 'text' || !block.text) {
      continue;
    }

    try {
      return JSON.parse(block.text);
    } catch {
      // Plain-text blocks are expected; only structured blocks are unwrapped.
    }
  }

  return undefined;
}

function extractToolErrorMessage(
  data: unknown,
  content: McpContentBlock[],
  toolName: string,
): string {
  if (isRecord(data) && typeof data.error === 'string') {
    return data.error;
  }

  const text = content.find((block) => block.text)?.text;
  return text ?? `MCP tool "${toolName}" failed`;
}
