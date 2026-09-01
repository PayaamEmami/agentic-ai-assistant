import { describe, expect, it } from 'vitest';
import {
  CRS_MCP_CAPABILITY,
  MCP_TOOL_PREFIX,
  TASK_BOARD_MCP_CAPABILITY,
  inferMcpCapability,
  isMcpToolName,
  isTaskBoardMcpCapability,
  mcpCapabilityForToolName,
  toNamespacedMcpToolName,
  toRemoteMcpToolName,
} from './names.js';

describe('MCP tool names', () => {
  it('namespaces tasks_* tools for the assistant', () => {
    expect(toNamespacedMcpToolName('tasks_list_boards')).toBe('mcp.tasks.list_boards');
    expect(toNamespacedMcpToolName('tasks_get_board')).toBe('mcp.tasks.get_board');
  });

  it('namespaces crs_* tools for the assistant', () => {
    expect(toNamespacedMcpToolName('crs_list_sources')).toBe('mcp.crs.list_sources');
    expect(toNamespacedMcpToolName('crs_ingest_source')).toBe('mcp.crs.ingest_source');
  });

  it('round-trips namespaced names back to the remote tool name', () => {
    expect(toRemoteMcpToolName('mcp.tasks.list_boards')).toBe('tasks_list_boards');
    expect(toRemoteMcpToolName('mcp.tasks.get_board')).toBe('tasks_get_board');
    expect(toRemoteMcpToolName('mcp.crs.list_sources')).toBe('crs_list_sources');
    expect(toRemoteMcpToolName('mcp.crs.ingest_source')).toBe('crs_ingest_source');
  });

  it('identifies namespaced MCP tools by prefix', () => {
    expect(isMcpToolName('mcp.tasks.list_boards')).toBe(true);
    expect(isMcpToolName('mcp.crs.list_sources')).toBe(true);
    expect(isMcpToolName('github.list_repositories')).toBe(false);
    expect(MCP_TOOL_PREFIX).toBe('mcp.');
  });

  it('routes namespaced tools to the owning connection slug', () => {
    expect(mcpCapabilityForToolName('mcp.tasks.list_boards')).toBe(TASK_BOARD_MCP_CAPABILITY);
    expect(mcpCapabilityForToolName('mcp.crs.list_sources')).toBe(CRS_MCP_CAPABILITY);
    expect(mcpCapabilityForToolName('github.list_repositories')).toBeNull();
  });

  it('treats the legacy tools capability as the task board', () => {
    expect(isTaskBoardMcpCapability('tools')).toBe(true);
    expect(isTaskBoardMcpCapability(TASK_BOARD_MCP_CAPABILITY)).toBe(true);
    expect(isTaskBoardMcpCapability(CRS_MCP_CAPABILITY)).toBe(false);
  });

  it('infers capability from server info and tool prefixes', () => {
    expect(inferMcpCapability({ serverName: 'tools-tasks', tools: [] })).toBe(
      TASK_BOARD_MCP_CAPABILITY,
    );
    expect(inferMcpCapability({ serverName: 'crs', tools: [] })).toBe(CRS_MCP_CAPABILITY);
    expect(
      inferMcpCapability({ tools: ['crs_list_sources', 'crs_get_feed'] }),
    ).toBe(CRS_MCP_CAPABILITY);
    expect(inferMcpCapability({ tools: ['tasks_list_boards'] })).toBe(
      TASK_BOARD_MCP_CAPABILITY,
    );
    expect(
      inferMcpCapability({ tools: ['tasks_list_boards', 'crs_list_sources'] }),
    ).toBeNull();
  });
});
