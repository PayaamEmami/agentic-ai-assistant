export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: McpServerInfo;
}

export interface McpContentBlock {
  type: string;
  text?: string;
}

export interface McpToolCallResult {
  content: McpContentBlock[];
  isError: boolean;
  /** Parsed from the first JSON text block when the server returns JSON. */
  data?: unknown;
}

export interface McpClientOptions {
  serverUrl: string;
  apiKey: string;
  /** Per-request timeout. MCP calls are read-modify-write, so keep it generous. */
  timeoutMs?: number;
  protocolVersion?: string;
  clientName?: string;
  clientVersion?: string;
}

/** A JSON-RPC level failure: transport, auth, or protocol error. */
export class McpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/**
 * A tool reported failure (`isError: true`). Distinct from `McpError` because
 * the server and transport worked; the tool itself refused or failed.
 */
export class McpToolError extends Error {
  constructor(
    message: string,
    readonly toolName: string,
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}
