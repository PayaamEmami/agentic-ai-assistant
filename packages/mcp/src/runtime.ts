import { getLogger } from '@aaa/observability';
import type {
  McpCatalogEntry,
  RuntimeMcpProfile,
  ToolExecutionInput,
  ToolExecutionOutput,
  UnifiedToolDescriptor,
} from './types.js';

const BUILT_IN_CATALOG: McpCatalogEntry[] = [];

class McpRuntime {
  private readonly logger = getLogger({ component: 'mcp-runtime' });

  listCatalog(): McpCatalogEntry[] {
    return BUILT_IN_CATALOG.map((entry) => ({ ...entry }));
  }

  listTools(_profiles: RuntimeMcpProfile[]): UnifiedToolDescriptor[] {
    return [];
  }

  async executeTool(_input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    return {
      success: false,
      result: null,
      error: 'No MCP integrations are available',
    };
  }

  async invalidateProfile(_profileId: string): Promise<void> {
    return;
  }

  async shutdown(): Promise<void> {
    this.logger.info(
      {
        event: 'mcp.runtime.shutdown',
        outcome: 'success',
      },
      'MCP runtime shut down',
    );
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
