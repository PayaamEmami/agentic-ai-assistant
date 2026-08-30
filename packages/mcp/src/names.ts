/**
 * MCP tools are namespaced so they never collide with a native tool and so the
 * worker can route them by prefix. Remote names use `tasks_*`; assistant names
 * use `mcp.tasks.*`.
 */
export const MCP_TOOL_PREFIX = 'mcp.';

export function toNamespacedMcpToolName(toolName: string): string {
  return `${MCP_TOOL_PREFIX}${toolName.replace(/^tasks_/, 'tasks.')}`;
}

export function toRemoteMcpToolName(namespacedName: string): string {
  return namespacedName.slice(MCP_TOOL_PREFIX.length).replace(/^tasks\./, 'tasks_');
}

export function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith(MCP_TOOL_PREFIX);
}
