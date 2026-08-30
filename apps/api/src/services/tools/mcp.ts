import Redis from 'ioredis';
import { appCapabilityConfigRepository } from '@aaa/db';
import { decryptCredentials } from '@aaa/knowledge-sources';
import { McpClient, toNamespacedMcpToolName, type McpToolDefinition } from '@aaa/mcp';
import type { AppConfig } from '../../config.js';
import { logger } from '../../lib/logger.js';

/**
 * MCP tools are namespaced so they can never collide with a native tool and so
 * the worker can route them by prefix alone.
 */
export {
  MCP_TOOL_PREFIX,
  isMcpToolName,
  toNamespacedMcpToolName,
  toRemoteMcpToolName,
} from '@aaa/mcp';

const TOOL_CACHE_TTL_SECONDS = 300;

export interface McpConnection {
  serverUrl: string;
  apiKey: string;
}

let redis: Redis | null = null;

export function configureMcpToolCache(config: Pick<AppConfig, 'redisUrl'>): void {
  redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
}

export async function closeMcpToolCache(): Promise<void> {
  const current = redis;
  redis = null;
  current?.disconnect();
}

/** Reads the user's MCP connection, or null when no MCP server is connected. */
export async function getMcpConnection(userId: string): Promise<McpConnection | null> {
  const config = await appCapabilityConfigRepository.findByUserAppAndCapability(
    userId,
    'mcp',
    'tools',
  );

  if (!config || config.status !== 'connected') {
    return null;
  }

  const serverUrl = config.settings['serverUrl'];
  if (typeof serverUrl !== 'string' || !serverUrl) {
    return null;
  }

  const credentials = decryptCredentials(config.encryptedCredentials);
  const apiKey = credentials['apiKey'];
  if (typeof apiKey !== 'string' || !apiKey) {
    return null;
  }

  return { serverUrl, apiKey };
}

export function createMcpClient(connection: McpConnection): McpClient {
  return new McpClient({
    serverUrl: connection.serverUrl,
    apiKey: connection.apiKey,
  });
}

/**
 * A remote tool that changes state needs approval in interactive chat. Read-only
 * tools do not, so browsing boards stays frictionless.
 */
function requiresApproval(tool: McpToolDefinition): boolean {
  const readOnlyVerbs = ['list', 'get', 'read', 'search'];
  const action = tool.name.split('_').slice(1).join('_');
  return !readOnlyVerbs.some((verb) => action.startsWith(verb));
}

function cacheKey(userId: string): string {
  return `mcp:tools:${userId}`;
}

async function readCachedTools(userId: string): Promise<McpToolDefinition[] | null> {
  if (!redis) {
    return null;
  }

  try {
    const cached = await redis.get(cacheKey(userId));
    return cached ? (JSON.parse(cached) as McpToolDefinition[]) : null;
  } catch (error) {
    logger.warn({ event: 'mcp.tools.cache_read_failed', error }, 'MCP tool cache read failed');
    return null;
  }
}

async function writeCachedTools(
  userId: string,
  tools: McpToolDefinition[],
): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    await redis.set(
      cacheKey(userId),
      JSON.stringify(tools),
      'EX',
      TOOL_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn({ event: 'mcp.tools.cache_write_failed', error }, 'MCP tool cache write failed');
  }
}

export async function invalidateMcpToolCache(userId: string): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    await redis.del(cacheKey(userId));
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

/**
 * Discovers the connected MCP server's tools, namespaced for the assistant.
 *
 * Discovery costs a network round trip on every chat turn, so results are cached
 * in Redis briefly. A discovery failure returns an empty list rather than
 * throwing: an unreachable MCP server must not break chat entirely.
 */
export async function loadMcpTools(userId: string): Promise<DiscoveredMcpTool[]> {
  const connection = await getMcpConnection(userId);
  if (!connection) {
    return [];
  }

  let tools = await readCachedTools(userId);

  if (!tools) {
    try {
      tools = await createMcpClient(connection).listTools();
      await writeCachedTools(userId, tools);
    } catch (error) {
      logger.warn(
        { event: 'mcp.tools.discovery_failed', error },
        'MCP tool discovery failed; continuing without MCP tools',
      );
      return [];
    }
  }

  return tools.map((tool) => ({
    name: toNamespacedMcpToolName(tool.name),
    description: tool.description,
    parameters: tool.inputSchema,
    requiresApproval: requiresApproval(tool),
  }));
}
