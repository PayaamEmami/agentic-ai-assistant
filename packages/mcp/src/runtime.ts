import { loadMcpServersConfig } from './config-loader.js';
import { ToolRegistry } from './registry.js';

let registryPromise: Promise<ToolRegistry> | null = null;

export async function getConfiguredToolRegistry(): Promise<ToolRegistry> {
  if (!registryPromise) {
    registryPromise = createConfiguredToolRegistry().catch((error) => {
      registryPromise = null;
      throw error;
    });
  }

  return registryPromise;
}

export async function closeConfiguredToolRegistry(): Promise<void> {
  if (!registryPromise) {
    return;
  }

  const registry = await registryPromise.catch(() => null);
  registryPromise = null;

  if (registry) {
    await registry.shutdown();
  }
}

async function createConfiguredToolRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  const configPath = process.env['MCP_SERVERS_CONFIG_PATH'];
  if (!configPath) {
    return registry;
  }

  const servers = await loadMcpServersConfig(configPath);
  for (const server of servers) {
    await registry.registerMcpServer(server);
  }

  return registry;
}
