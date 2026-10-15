import Redis from 'ioredis';
import { appCapabilityConfigRepository, type AppCapabilityConfig } from '@aaa/db';
import { decryptCredentials } from '@aaa/knowledge-sources';
import {
  CRS_MCP_CAPABILITY,
  LEGACY_MCP_CAPABILITY,
  TASK_BOARD_MCP_CAPABILITY,
  createMcpClientForConnection,
  findMcpConnection,
  hydrateMcpConnection,
  toNamespacedMcpToolName,
  withoutLegacyMcpDuplicate,
  type HydratedMcpConnection,
  type McpToolDefinition,
} from '@aaa/mcp';
import type { AppConfig } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { mcpToolRequiresApproval } from './mcp-approval.js';

export { mcpToolRequiresApproval } from './mcp-approval.js';

/**
 * MCP tools are namespaced so they can never collide with a native tool and so
 * the worker can route them by prefix alone.
 */
export {
  CRS_MCP_CAPABILITY,
  MCP_TOOL_PREFIX,
  TASK_BOARD_MCP_CAPABILITY,
  inferMcpCapability,
  isMcpToolName,
  isTaskBoardMcpCapability,
  isValidMcpCapabilitySlug,
  mcpCapabilityForToolName,
  toNamespacedMcpToolName,
  toRemoteMcpToolName,
} from '@aaa/mcp';

const TOOL_CACHE_TTL_SECONDS = 300;

export type McpConnection = HydratedMcpConnection;

let redis: Redis | null = null;

export function configureMcpToolCache(config: Pick<AppConfig, 'redisUrl'>): void {
  redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
}

export async function closeMcpToolCache(): Promise<void> {
  const current = redis;
  redis = null;
  current?.disconnect();
}

function connectionFromConfig(config: AppCapabilityConfig): McpConnection | null {
  if (config.status !== 'connected') {
    return null;
  }

  const serverUrl = config.settings['serverUrl'];
  if (typeof serverUrl !== 'string' || !serverUrl) {
    return null;
  }

  return hydrateMcpConnection({
    capability: config.capability,
    status: config.status,
    settings: config.settings,
    credentials: decryptCredentials(config.encryptedCredentials),
  });
}

export async function getMcpConnections(userId: string): Promise<McpConnection[]> {
  const configs = await appCapabilityConfigRepository.listByUserAndApp(userId, 'mcp');
  const connections = configs.flatMap((config) => {
    const connection = connectionFromConfig(config);
    return connection ? [connection] : [];
  });
  return withoutLegacyMcpDuplicate(connections);
}

/** Reads one MCP connection. Task-board lookups also accept the legacy `tools` slug. */
export async function getMcpConnection(
  userId: string,
  capability: string,
): Promise<McpConnection | null> {
  return findMcpConnection(await getMcpConnections(userId), capability);
}

export function createMcpClient(connection: {
  capability: string;
  serverUrl: string;
  apiKey: string;
}): ReturnType<typeof createMcpClientForConnection> {
  return createMcpClientForConnection(connection);
}

function requiresApproval(tool: McpToolDefinition): boolean {
  return mcpToolRequiresApproval(tool.name);
}

function cacheKey(userId: string, capability: string): string {
  return `mcp:tools:${userId}:${capability}`;
}

async function readCachedTools(
  userId: string,
  capability: string,
): Promise<McpToolDefinition[] | null> {
  if (!redis) {
    return null;
  }

  try {
    const cached = await redis.get(cacheKey(userId, capability));
    return cached ? (JSON.parse(cached) as McpToolDefinition[]) : null;
  } catch (error) {
    logger.warn({ event: 'mcp.tools.cache_read_failed', error }, 'MCP tool cache read failed');
    return null;
  }
}

async function writeCachedTools(
  userId: string,
  capability: string,
  tools: McpToolDefinition[],
): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    await redis.set(
      cacheKey(userId, capability),
      JSON.stringify(tools),
      'EX',
      TOOL_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn({ event: 'mcp.tools.cache_write_failed', error }, 'MCP tool cache write failed');
  }
}

export async function invalidateMcpToolCache(userId: string, capability?: string): Promise<void> {
  if (!redis) {
    return;
  }

  const keys = [
    cacheKey(userId, TASK_BOARD_MCP_CAPABILITY),
    cacheKey(userId, CRS_MCP_CAPABILITY),
    cacheKey(userId, LEGACY_MCP_CAPABILITY),
    `mcp:tools:${userId}`,
  ];
  if (capability) {
    keys.push(cacheKey(userId, capability));
  }

  try {
    await redis.del(...keys);
  } catch (error) {
    logger.warn(
      { event: 'mcp.tools.cache_invalidate_failed', error },
      'MCP tool cache invalidation failed',
    );
  }
}

export interface DiscoveredMcpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
}

async function listToolsForConnection(
  userId: string,
  connection: McpConnection,
): Promise<McpToolDefinition[]> {
  const cached = await readCachedTools(userId, connection.capability);
  if (cached) {
    return cached;
  }

  const tools = await createMcpClient(connection).listTools();
  await writeCachedTools(userId, connection.capability, tools);
  return tools;
}

/**
 * Discovers every connected MCP server's tools, namespaced for the assistant.
 *
 * Discovery costs a network round trip on every chat turn, so results are cached
 * in Redis briefly. A discovery failure on one server returns the others rather than
 * throwing: an unreachable MCP server must not break chat entirely.
 */
export async function loadMcpTools(userId: string): Promise<DiscoveredMcpTool[]> {
  const connections = await getMcpConnections(userId);
  if (connections.length === 0) {
    return [];
  }

  const discovered: DiscoveredMcpTool[] = [];

  for (const connection of connections) {
    try {
      const tools = await listToolsForConnection(userId, connection);
      for (const tool of tools) {
        discovered.push({
          name: toNamespacedMcpToolName(tool.name),
          description: tool.description,
          parameters: tool.inputSchema,
          requiresApproval: requiresApproval(tool),
        });
      }
    } catch (error) {
      logger.warn(
        {
          event: 'mcp.tools.discovery_failed',
          error,
          capability: connection.capability,
        },
        'MCP tool discovery failed for one server; continuing with the rest',
      );
    }
  }

  return discovered;
}
