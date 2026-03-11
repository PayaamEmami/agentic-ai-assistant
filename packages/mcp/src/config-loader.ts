import { readFile } from 'node:fs/promises';
import type { McpServerConfig } from './types.js';

export async function loadMcpServersConfig(
  path: string,
): Promise<McpServerConfig[]> {
  // TODO: add validation with zod
  const raw = await readFile(path, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).servers)
  ) {
    throw new Error('MCP config must have a "servers" array');
  }
  return (parsed as Record<string, unknown>).servers as McpServerConfig[];
}
