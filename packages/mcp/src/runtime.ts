import { getLogger } from '@aaa/observability';
import { PlaywrightProfileClient } from './playwright-integration.js';
import type {
  McpCatalogEntry,
  RuntimeMcpProfile,
  ToolExecutionInput,
  ToolExecutionOutput,
  UnifiedToolDescriptor,
} from './types.js';

const BUILT_IN_CATALOG: McpCatalogEntry[] = [
  {
    kind: 'playwright',
    displayName: 'Playwright Browser',
    description:
      'Web browser automation with persisted session state, screenshots, extraction, controlled interactions, and interactive handoff sessions.',
    supportsMultipleProfiles: true,
    requiresDefaultProfile: true,
    authModes: ['embedded_browser', 'stored_secret'],
  },
];

interface RuntimeClient {
  listTools(): UnifiedToolDescriptor[];
  updateProfile(profile: RuntimeMcpProfile): void;
  executeTool(input: ToolExecutionInput): Promise<ToolExecutionOutput>;
  shutdown?(): Promise<void>;
}

class McpRuntime {
  private readonly clients = new Map<string, RuntimeClient>();
  private readonly logger = getLogger({ component: 'mcp-runtime' });

  listCatalog(): McpCatalogEntry[] {
    return BUILT_IN_CATALOG.map((entry) => ({ ...entry }));
  }

  listTools(profiles: RuntimeMcpProfile[]): UnifiedToolDescriptor[] {
    return profiles.flatMap((profile) => {
      const client = this.getClient(profile);
      return client.listTools();
    });
  }

  async executeTool(input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    const client = this.getClient(input.profile);
    return client.executeTool(input);
  }

  async invalidateProfile(profileId: string): Promise<void> {
    const client = this.clients.get(profileId);
    this.clients.delete(profileId);
    if (client?.shutdown) {
      await client.shutdown();
    }
  }

  async shutdown(): Promise<void> {
    const clients = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.all(clients.map((client) => client.shutdown?.()));
    this.logger.info(
      {
        event: 'mcp.runtime.shutdown',
        outcome: 'success',
      },
      'MCP runtime shut down',
    );
  }

  private getClient(profile: RuntimeMcpProfile): RuntimeClient {
    const existing = this.clients.get(profile.id);
    if (existing) {
      existing.updateProfile(profile);
      return existing;
    }

    let client: RuntimeClient;
    switch (profile.integrationKind) {
      case 'playwright':
        client = new PlaywrightProfileClient(profile);
        break;
      default:
        throw new Error(`Unsupported MCP integration: ${profile.integrationKind}`);
    }

    this.clients.set(profile.id, client);
    return client;
  }
}

let runtime: McpRuntime | null = null;

export function getMcpRuntime(): McpRuntime {
  if (!runtime) {
    runtime = new McpRuntime();
  }

  return runtime;
}

export async function closeMcpRuntime(): Promise<void> {
  if (!runtime) {
    return;
  }

  const current = runtime;
  runtime = null;
  await current.shutdown();
}
