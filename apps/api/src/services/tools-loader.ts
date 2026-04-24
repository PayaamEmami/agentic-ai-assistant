import { mcpProfileRepository } from '@aaa/db';
import { decryptCredentials } from '@aaa/knowledge-sources';
import {
  getMcpRuntime,
  type RuntimeMcpProfile,
  type UnifiedToolDescriptor,
} from '@aaa/mcp';
import { NATIVE_TOOL_DEFINITIONS } from '@aaa/shared';

export type AvailableTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  origin: 'native' | 'mcp';
  mcpProfileId?: string;
  integrationKind?: string;
  profileLabel?: string;
};

function toNativeAvailableTools(): AvailableTool[] {
  return NATIVE_TOOL_DEFINITIONS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
    origin: 'native',
  }));
}

function toAvailableTool(tool: UnifiedToolDescriptor): AvailableTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    requiresApproval: tool.requiresApproval,
    origin: tool.origin,
    mcpProfileId: tool.mcpProfileId,
    integrationKind: tool.integrationKind,
    profileLabel: tool.profileLabel,
  };
}

function toRuntimeMcpProfile(
  profile: Awaited<ReturnType<typeof mcpProfileRepository.listConnectedByUser>>[number],
): RuntimeMcpProfile {
  return {
    id: profile.id,
    userId: profile.userId,
    integrationKind: profile.integrationKind as RuntimeMcpProfile['integrationKind'],
    profileLabel: profile.profileLabel,
    status: profile.status,
    settings: profile.settings,
    credentials: decryptCredentials(profile.encryptedCredentials),
  };
}

export async function loadAvailableTools(
  userId: string,
  requestContent: string,
): Promise<AvailableTool[]> {
  const tools = [...toNativeAvailableTools()];

  try {
    const runtime = getMcpRuntime();
    const connectedMcpProfiles = await mcpProfileRepository.listConnectedByUser(userId);
    const requestContentLower = requestContent.toLowerCase();
    const byKind = new Map<string, typeof connectedMcpProfiles>();

    for (const profile of connectedMcpProfiles) {
      const existing = byKind.get(profile.integrationKind) ?? [];
      existing.push(profile);
      byKind.set(profile.integrationKind, existing);
    }

    const selectedProfiles: RuntimeMcpProfile[] = [];
    for (const profiles of byKind.values()) {
      const explicit = profiles.find((profile) =>
        requestContentLower.includes(profile.profileLabel.toLowerCase()),
      );
      const selected = explicit ?? profiles.find((profile) => profile.isDefault) ?? profiles[0];
      if (selected) {
        selectedProfiles.push(toRuntimeMcpProfile(selected));
      }
    }

    const mcpTools = runtime
      .listTools(selectedProfiles)
      .map<AvailableTool>((tool) => toAvailableTool(tool));
    tools.push(...mcpTools);
  } catch {
    // Fall back to native tools only if MCP loading fails.
  }

  return tools;
}
