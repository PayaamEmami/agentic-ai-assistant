import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { McpError } from './types.js';

const DNS_TIMEOUT_MS = 5_000;

const BLOCKED_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.google.com',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

const BLOCKED_NAME_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

/**
 * Addresses that are not globally routable. A saved MCP URL is called with the
 * bearer key, so these must never be the connection target.
 */
const BLOCKED_ADDRESSES = new BlockList();

for (const [subnet, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(subnet, prefix, 'ipv4');
}

BLOCKED_ADDRESSES.addAddress('::', 'ipv6');
BLOCKED_ADDRESSES.addAddress('::1', 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('fec0::', 10, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('ff00::', 8, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('100::', 64, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('2001::', 32, 'ipv6');
BLOCKED_ADDRESSES.addSubnet('2001:db8::', 32, 'ipv6');

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isBlockedName(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === 'local' ||
    hostname === 'internal' ||
    hostname === 'home.arpa' ||
    BLOCKED_METADATA_HOSTS.has(hostname) ||
    BLOCKED_NAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return true;
  }

  return false;
}

function parseIpv6(address: string): Uint8Array | null {
  let head = address.toLowerCase().split('%')[0] ?? '';
  const dotted = head.match(/^(.+):(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted?.[1] && dotted[2]) {
    const octets = dotted[2].split('.').map((part) => Number(part));
    if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) {
      return null;
    }
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    head = `${dotted[1]}:${high}:${low}`;
  }

  const halves = head.split('::');
  if (halves.length > 2) {
    return null;
  }

  const expand = (side: string): string[] | null => {
    if (side === '') {
      return [];
    }
    const groups = side.split(':');
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
      return null;
    }
    return groups;
  };

  const left = expand(halves[0] ?? '');
  const right = halves.length === 2 ? expand(halves[1] ?? '') : [];
  if (!left || !right) {
    return null;
  }
  if (halves.length === 1 && left.length !== 8) {
    return null;
  }
  if (halves.length === 2 && left.length + right.length > 8) {
    return null;
  }

  const groups =
    halves.length === 2
      ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
      : left;
  if (groups.length !== 8) {
    return null;
  }

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function ipv4At(bytes: Uint8Array, offset: number): string {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

function prefixIs(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/**
 * IPv4 carried inside a transition address. NAT64, 6to4, and IPv4-mapped forms
 * can name a loopback or LAN target even when the text is not a private literal.
 */
function embeddedIpv4(bytes: Uint8Array): string | null {
  const mapped =
    bytes.subarray(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped || bytes.subarray(0, 12).every((byte) => byte === 0)) {
    return ipv4At(bytes, 12);
  }

  // 64:ff9b::/96, the well-known NAT64 prefix.
  if (prefixIs(bytes, [0x00, 0x64, 0xff, 0x9b]) && bytes.subarray(4, 12).every((byte) => byte === 0)) {
    return ipv4At(bytes, 12);
  }

  // 64:ff9b:1::/48, the local-use NAT64 prefix. The IPv4 is the last 32 bits.
  if (prefixIs(bytes, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01])) {
    return ipv4At(bytes, 12);
  }

  // 2002::/16, 6to4. The IPv4 is the next 32 bits.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return ipv4At(bytes, 2);
  }

  return null;
}

export function isBlockedIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return BLOCKED_ADDRESSES.check(address, 'ipv4');
  }
  if (family !== 6) {
    return true;
  }
  if (BLOCKED_ADDRESSES.check(address, 'ipv6')) {
    return true;
  }

  const bytes = parseIpv6(address);
  if (!bytes) {
    return true;
  }
  const embedded = embeddedIpv4(bytes);
  return embedded !== null && BLOCKED_ADDRESSES.check(embedded, 'ipv4');
}

function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (isBlockedName(host)) {
    return true;
  }
  if (isIP(host) !== 0) {
    return isBlockedIp(host);
  }
  return false;
}

/**
 * Rejects MCP server URLs that are not public HTTPS. Checked on every client
 * construct, not only at save time, so a stored literal cannot target loopback,
 * link-local, CGNAT, or a private address embedded in IPv6.
 *
 * Hostnames still need {@link resolvePinnedAddress}: a name such as
 * `127.0.0.1.nip.io` is not a literal, and the connection must be pinned to the
 * addresses checked here so a later lookup cannot switch to a private target.
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

  if (isBlockedHostname(parsed.hostname)) {
    throw new McpError('The MCP server URL cannot point at a local or private address');
  }

  return trimmed;
}

async function resolveAddresses(hostname: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new McpError('Could not resolve the MCP server URL'));
    }, DNS_TIMEOUT_MS);

    lookup(hostname, { all: true, verbatim: true }).then(
      (records) => {
        clearTimeout(timer);
        resolve(records);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof McpError ? error : new McpError('Could not resolve the MCP server URL'));
      },
    );
  });
}

/**
 * Resolves every address for a public HTTPS URL and returns one that is safe to
 * connect to. Callers must connect to this address instead of looking the name
 * up again. Any private address in the set rejects the URL.
 */
export async function resolvePinnedAddress(serverUrl: string): Promise<PinnedAddress> {
  const parsed = new URL(assertPublicHttpsUrl(serverUrl));
  const host = normalizeHost(parsed.hostname);
  const literalFamily = isIP(host);
  if (literalFamily === 4 || literalFamily === 6) {
    return { address: host, family: literalFamily };
  }

  const records = await resolveAddresses(host);
  if (records.length === 0) {
    throw new McpError('Could not resolve the MCP server URL');
  }
  if (records.some((record) => isBlockedIp(record.address))) {
    throw new McpError('The MCP server URL cannot point at a local or private address');
  }

  const chosen = records[0];
  if (!chosen || (chosen.family !== 4 && chosen.family !== 6)) {
    throw new McpError('Could not resolve the MCP server URL');
  }
  return { address: chosen.address, family: chosen.family };
}
