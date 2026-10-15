import { describe, expect, it } from 'vitest';
import {
  findMcpConnection,
  hydrateMcpConnection,
  mcpRequestTimeoutMs,
  resolveMcpConnectionForNamespace,
  toolPrefixesFromSettings,
  withoutLegacyMcpDuplicate,
  type HydratedMcpConnection,
} from './connections.js';
import { CRS_MCP_CAPABILITY, CRS_MCP_TIMEOUT_MS, TASK_BOARD_MCP_CAPABILITY } from './names.js';

function connection(
  capability: string,
  toolPrefixes: string[] = [],
): HydratedMcpConnection {
  return {
    capability,
    serverUrl: `https://${capability}.example.com/mcp`,
    apiKey: 'secret',
    toolPrefixes,
  };
}

describe('MCP connection hydration', () => {
  it('reads tool prefixes saved at connect time', () => {
    expect(
      toolPrefixesFromSettings({ toolPrefixes: ['tasks', '', 1, 'docs'] }),
    ).toEqual(['tasks', 'docs']);
    expect(toolPrefixesFromSettings({})).toEqual([]);
  });

  it('skips rows that are disconnected or missing a URL or API key', () => {
    expect(
      hydrateMcpConnection({
        capability: 'tools',
        status: 'pending',
        settings: { serverUrl: 'https://example.com/mcp' },
        credentials: { apiKey: 'secret' },
      }),
    ).toBeNull();
    expect(
      hydrateMcpConnection({
        capability: 'tools',
        status: 'connected',
        settings: {},
        credentials: { apiKey: 'secret' },
      }),
    ).toBeNull();
    expect(
      hydrateMcpConnection({
        capability: 'tools',
        status: 'connected',
        settings: { serverUrl: 'https://example.com/mcp', serverName: 'Tools', toolPrefixes: ['tasks', 'docs'] },
        credentials: {},
      }),
    ).toBeNull();
  });

  it('hydrates a connected server including its prefixes', () => {
    expect(
      hydrateMcpConnection({
        capability: 'tools',
        status: 'connected',
        settings: {
          serverUrl: 'https://example.com/mcp',
          serverName: 'Tools',
          toolPrefixes: ['tasks', 'docs'],
        },
        credentials: { apiKey: 'secret' },
      }),
    ).toEqual({
      capability: 'tools',
      serverUrl: 'https://example.com/mcp',
      apiKey: 'secret',
      serverName: 'Tools',
      toolPrefixes: ['tasks', 'docs'],
    });
  });

  it('hides the legacy tools slug only when a task-board row is connected', () => {
    const tools = connection('tools', ['tasks', 'docs']);
    const board = connection(TASK_BOARD_MCP_CAPABILITY, ['tasks']);
    const crs = connection('crs', ['crs']);

    expect(withoutLegacyMcpDuplicate([tools, crs])).toEqual([tools, crs]);
    expect(withoutLegacyMcpDuplicate([tools, board, crs])).toEqual([board, crs]);
  });

  it('treats a legacy tools lookup as the task board', () => {
    const tools = connection('tools', ['tasks']);
    const crs = connection('crs', ['crs']);
    expect(findMcpConnection([tools, crs], 'task-board')).toBe(tools);
    expect(findMcpConnection([tools, crs], 'crs')).toBe(crs);
    expect(findMcpConnection([crs], 'task-board')).toBeNull();
  });

  it('routes execution by exact capability before advertised prefixes', () => {
    const tools = connection('tools', ['tasks', 'docs', 'finances']);
    const board = connection(TASK_BOARD_MCP_CAPABILITY, ['tasks']);

    expect(resolveMcpConnectionForNamespace([tools], 'docs')).toBe(tools);
    expect(resolveMcpConnectionForNamespace([board, tools], 'tasks')).toBe(board);
    expect(resolveMcpConnectionForNamespace([tools], 'missing')).toBeNull();
  });

  it('gives the CRS server a longer request timeout', () => {
    expect(mcpRequestTimeoutMs(CRS_MCP_CAPABILITY)).toBe(CRS_MCP_TIMEOUT_MS);
    expect(mcpRequestTimeoutMs('tools')).toBeUndefined();
  });
});
