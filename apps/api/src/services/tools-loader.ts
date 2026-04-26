import { NATIVE_TOOL_DEFINITIONS } from '@aaa/shared';

export type AvailableTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
};

export async function loadAvailableTools(_userId: string): Promise<AvailableTool[]> {
  return NATIVE_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
  }));
}
