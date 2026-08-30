import { describe, expect, it } from 'vitest';
import {
  MCP_TOOL_PREFIX,
  isMcpToolName,
  toNamespacedMcpToolName,
  toRemoteMcpToolName,
} from './names.js';

describe('MCP tool names', () => {
  it('namespaces tasks_* tools for the assistant', () => {
    expect(toNamespacedMcpToolName('tasks_list_boards')).toBe('mcp.tasks.list_boards');
    expect(toNamespacedMcpToolName('tasks_get_board')).toBe('mcp.tasks.get_board');
  });

  it('round-trips namespaced names back to the remote tool name', () => {
    expect(toRemoteMcpToolName('mcp.tasks.list_boards')).toBe('tasks_list_boards');
    expect(toRemoteMcpToolName('mcp.tasks.get_board')).toBe('tasks_get_board');
  });

  it('identifies namespaced MCP tools by prefix', () => {
    expect(isMcpToolName('mcp.tasks.list_boards')).toBe(true);
    expect(isMcpToolName('github.list_repositories')).toBe(false);
    expect(MCP_TOOL_PREFIX).toBe('mcp.');
  });
});
