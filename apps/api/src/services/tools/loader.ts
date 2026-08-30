import { NATIVE_TOOL_DEFINITIONS } from '@aaa/shared';
import { loadMcpTools } from './mcp.js';

export type AvailableTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
};

export async function loadAvailableTools(userId: string): Promise<AvailableTool[]> {
  const nativeTools: AvailableTool[] = NATIVE_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
  }));

  return [...nativeTools, ...(await loadMcpTools(userId))];
}
