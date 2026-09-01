/**
 * MCP tools are namespaced so they never collide with a native tool and so the
 * worker can route them by prefix. Remote names use `{prefix}_*`; assistant names
 * use `mcp.{prefix}.*` (for example `tasks_list_boards` → `mcp.tasks.list_boards`).
 */
export const MCP_TOOL_PREFIX = 'mcp.';

export const TASK_BOARD_MCP_CAPABILITY = 'task-board';
export const CRS_MCP_CAPABILITY = 'crs';
export const LEGACY_MCP_CAPABILITY = 'tools';

export const MCP_CAPABILITY_SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export const CRS_MCP_TIMEOUT_MS = 120_000;

export function isValidMcpCapabilitySlug(value: string): boolean {
  return MCP_CAPABILITY_SLUG_PATTERN.test(value);
}

export function isTaskBoardMcpCapability(capability: string): boolean {
  return capability === TASK_BOARD_MCP_CAPABILITY || capability === LEGACY_MCP_CAPABILITY;
}

export function toNamespacedMcpToolName(toolName: string): string {
  const match = toolName.match(/^([a-z0-9]+)_([\s\S]+)$/);
  if (!match) {
    return `${MCP_TOOL_PREFIX}${toolName}`;
  }
  return `${MCP_TOOL_PREFIX}${match[1]}.${match[2]}`;
}

export function toRemoteMcpToolName(namespacedName: string): string {
  const withoutPrefix = namespacedName.startsWith(MCP_TOOL_PREFIX)
    ? namespacedName.slice(MCP_TOOL_PREFIX.length)
    : namespacedName;
  return withoutPrefix.replace(/^([a-z0-9]+)\./, '$1_');
}

export function isMcpToolName(toolName: string): boolean {
  return toolName.startsWith(MCP_TOOL_PREFIX);
}

export function mcpNamespaceForToolName(namespacedName: string): string | null {
  if (!isMcpToolName(namespacedName)) {
    return null;
  }

  const rest = namespacedName.slice(MCP_TOOL_PREFIX.length);
  const dot = rest.indexOf('.');
  return dot === -1 ? rest : rest.slice(0, dot);
}

export function mcpCapabilityForNamespace(namespace: string): string {
  return namespace === 'tasks' ? TASK_BOARD_MCP_CAPABILITY : namespace;
}

export function mcpCapabilityForToolName(namespacedName: string): string | null {
  const namespace = mcpNamespaceForToolName(namespacedName);
  return namespace ? mcpCapabilityForNamespace(namespace) : null;
}

/**
 * Pick a storage slug for a newly connected server from its handshake.
 * `tools-tasks` and `tasks_*` tools map to the board automation connection.
 */
export function inferMcpCapability(input: {
  serverName?: string;
  tools: string[];
}): string | null {
  const name = input.serverName?.trim().toLowerCase();
  if (name === 'tools-tasks' || name === TASK_BOARD_MCP_CAPABILITY) {
    return TASK_BOARD_MCP_CAPABILITY;
  }
  if (name === CRS_MCP_CAPABILITY) {
    return CRS_MCP_CAPABILITY;
  }

  const prefixes = new Set<string>();
  for (const tool of input.tools) {
    const match = tool.match(/^([a-z0-9]+)_/);
    if (match) {
      prefixes.add(match[1]!);
    }
  }

  if (prefixes.size === 1) {
    return mcpCapabilityForNamespace([...prefixes][0]!);
  }

  return null;
}
