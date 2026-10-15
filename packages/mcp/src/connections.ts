import { McpClient } from './client.js';
import {
  CRS_MCP_CAPABILITY,
  CRS_MCP_TIMEOUT_MS,
  LEGACY_MCP_CAPABILITY,
  TASK_BOARD_MCP_CAPABILITY,
  isTaskBoardMcpCapability,
  selectMcpCapabilityForNamespace,
} from './names.js';

/**
 * A saved MCP row after credentials are decrypted. Callers own decryption so
 * disconnected or URL-less rows are never decrypted.
 */
export interface McpCapabilityConfig {
  capability: string;
  status: string;
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface HydratedMcpConnection {
  capability: string;
  serverUrl: string;
  apiKey: string;
  serverName?: string;
  toolPrefixes: string[];
}

/** Prefixes saved at connect time. One server may own several (`tasks`, `docs`, …). */
export function toolPrefixesFromSettings(settings: Record<string, unknown>): string[] {
  const value = settings['toolPrefixes'];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * Turns a connected config into a client-ready connection.
 *
 * Returns null when the row is not connected or is missing a server URL or API
 * key. Those rows are skipped during discovery rather than failing the turn.
 */
export function hydrateMcpConnection(config: McpCapabilityConfig): HydratedMcpConnection | null {
  if (config.status !== 'connected') {
    return null;
  }

  const serverUrl = config.settings['serverUrl'];
  if (typeof serverUrl !== 'string' || !serverUrl) {
    return null;
  }

  const apiKey = config.credentials['apiKey'];
  if (typeof apiKey !== 'string' || !apiKey) {
    return null;
  }

  const serverName = config.settings['serverName'];
  return {
    capability: config.capability,
    serverUrl,
    apiKey,
    serverName: typeof serverName === 'string' && serverName ? serverName : undefined,
    toolPrefixes: toolPrefixesFromSettings(config.settings),
  };
}

/**
 * Hides the legacy `tools` slug when a dedicated `task-board` row is connected,
 * so discovery does not list the same task tools twice.
 */
export function withoutLegacyMcpDuplicate(
  connections: HydratedMcpConnection[],
): HydratedMcpConnection[] {
  const hasTaskBoard = connections.some(
    (connection) => connection.capability === TASK_BOARD_MCP_CAPABILITY,
  );
  return hasTaskBoard
    ? connections.filter((connection) => connection.capability !== LEGACY_MCP_CAPABILITY)
    : connections;
}

/** Task-board lookups also accept the legacy `tools` slug. */
export function findMcpConnection(
  connections: HydratedMcpConnection[],
  capability: string,
): HydratedMcpConnection | null {
  if (isTaskBoardMcpCapability(capability)) {
    return connections.find((connection) => isTaskBoardMcpCapability(connection.capability)) ?? null;
  }
  return connections.find((connection) => connection.capability === capability) ?? null;
}

/**
 * Chooses the connection that should execute tools in `namespace`.
 *
 * An exact capability match wins; otherwise the connection that advertised the
 * prefix wins. Discovery's legacy-slug filter is intentionally not applied here.
 */
export function resolveMcpConnectionForNamespace<
  T extends { capability: string; toolPrefixes?: readonly string[] },
>(connections: T[], namespace: string): T | null {
  const capability = selectMcpCapabilityForNamespace(connections, namespace);
  if (!capability) {
    return null;
  }
  return connections.find((connection) => connection.capability === capability) ?? null;
}

export function mcpRequestTimeoutMs(capability: string): number | undefined {
  return capability === CRS_MCP_CAPABILITY ? CRS_MCP_TIMEOUT_MS : undefined;
}

export function createMcpClientForConnection(connection: {
  capability: string;
  serverUrl: string;
  apiKey: string;
}): McpClient {
  return new McpClient({
    serverUrl: connection.serverUrl,
    apiKey: connection.apiKey,
    timeoutMs: mcpRequestTimeoutMs(connection.capability),
  });
}
