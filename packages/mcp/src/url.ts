import { McpError } from './types.js';

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const first = parts[0];
  const second = parts[1];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

const BLOCKED_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.google.com',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  if (BLOCKED_METADATA_HOSTS.has(host)) {
    return true;
  }

  if (host.includes(':')) {
    if (
      host === '::1' ||
      host.startsWith('fe80:') ||
      host.startsWith('fc') ||
      host.startsWith('fd')
    ) {
      return true;
    }

    if (host.startsWith('::ffff:')) {
      const mapped = host.slice('::ffff:'.length);
      return mapped.includes('.') ? isPrivateIPv4(mapped) : true;
    }

    return false;
  }

  return isPrivateIPv4(host);
}

/**
 * Rejects MCP server URLs that are not public HTTPS. Checked on every client
 * construct, not only at save time, so a stored URL cannot later target a
 * private address and `fetch` is never pointed at loopback or link-local hosts.
 */
export function assertPublicHttpsUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim();
  if (!trimmed) {
    throw new McpError('An MCP server URL is required');
  }

  if (!/^https:\/\//i.test(trimmed)) {
    throw new McpError('The MCP server URL must start with https://');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new McpError('The MCP server URL is not a valid URL');
  }

  if (parsed.username || parsed.password) {
    throw new McpError('The MCP server URL cannot include credentials');
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new McpError('The MCP server URL cannot point at a local or private address');
  }

  return trimmed;
}
