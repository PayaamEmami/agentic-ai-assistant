import { getLogger } from '@aaa/observability';
import { PlaywrightConnectionClient } from './playwright-integration.js';
import type {
  McpCatalogEntry,
  ManualAuthSessionCompleteResult,
  ManualAuthSessionStartResult,
  RuntimeMcpConnection,
  ToolExecutionInput,
  ToolExecutionOutput,
  UnifiedToolDescriptor,
} from './types.js';

const BUILT_IN_CATALOG: McpCatalogEntry[] = [
  {
    kind: 'playwright',
    displayName: 'Playwright Browser',
    description:
      'Web browser automation with persisted session state, screenshots, extraction, and controlled interactions.',
    supportsMultipleInstances: true,
    requiresDefaultActive: true,
    authModes: ['manual_browser', 'stored_secret'],
  },
];

interface RuntimeClient {
  listTools(): UnifiedToolDescriptor[];
  updateConnection(connection: RuntimeMcpConnection): void;
  executeTool(input: ToolExecutionInput): Promise<ToolExecutionOutput>;
  startManualAuthSession?(authSessionId: string): Promise<ManualAuthSessionStartResult>;
  completeManualAuthSession?(authSessionId: string): Promise<ManualAuthSessionCompleteResult>;
  cancelAuthSession?(authSessionId: string): Promise<void>;
  shutdown?(): Promise<void>;
}

class McpRuntime {
  private readonly clients = new Map<string, RuntimeClient>();
  private readonly logger = getLogger({ component: 'mcp-runtime' });

  listCatalog(): McpCatalogEntry[] {
    return BUILT_IN_CATALOG.map((entry) => ({ ...entry }));
  }

  listTools(connections: RuntimeMcpConnection[]): UnifiedToolDescriptor[] {
    return connections.flatMap((connection) => {
      const client = this.getClient(connection);
      return client.listTools();
    });
  }

  async executeTool(input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    const client = this.getClient(input.connection);
    return client.executeTool(input);
  }

  async startManualAuthSession(
    connection: RuntimeMcpConnection,
    authSessionId: string,
  ): Promise<ManualAuthSessionStartResult> {
    const client = this.getClient(connection);
    if (!client.startManualAuthSession) {
      throw new Error(`Integration does not support manual auth sessions: ${connection.integrationKind}`);
    }

    return client.startManualAuthSession(authSessionId);
  }

  async completeManualAuthSession(
    connection: RuntimeMcpConnection,
    authSessionId: string,
  ): Promise<ManualAuthSessionCompleteResult> {
    const client = this.getClient(connection);
    if (!client.completeManualAuthSession) {
      throw new Error(`Integration does not support manual auth completion: ${connection.integrationKind}`);
    }

    return client.completeManualAuthSession(authSessionId);
  }

  async invalidateConnection(connectionId: string): Promise<void> {
    const client = this.clients.get(connectionId);
    this.clients.delete(connectionId);
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

  private getClient(connection: RuntimeMcpConnection): RuntimeClient {
    const existing = this.clients.get(connection.id);
    if (existing) {
      existing.updateConnection(connection);
      return existing;
    }

    let client: RuntimeClient;
    switch (connection.integrationKind) {
      case 'playwright':
        client = new PlaywrightConnectionClient(connection);
        break;
      default:
        throw new Error(`Unsupported MCP integration: ${connection.integrationKind}`);
    }

    this.clients.set(connection.id, client);
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
