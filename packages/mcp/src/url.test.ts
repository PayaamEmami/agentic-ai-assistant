import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpError } from './types.js';
import { assertPublicHttpsUrl, isBlockedIp, resolvePinnedAddress } from './url.js';

const lookup = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup,
}));

describe('assertPublicHttpsUrl', () => {
  it('accepts a public https URL', () => {
    expect(assertPublicHttpsUrl(' https://mcp.example.com/path ')).toBe(
      'https://mcp.example.com/path',
    );
  });

  it('rejects a missing URL', () => {
    expect(() => assertPublicHttpsUrl('')).toThrow(McpError);
    expect(() => assertPublicHttpsUrl('   ')).toThrow(/required/);
  });

  it('rejects non-https URLs', () => {
    expect(() => assertPublicHttpsUrl('http://mcp.example.com/')).toThrow(/https:\/\//);
  });

  it('rejects credentials in the URL', () => {
    expect(() => assertPublicHttpsUrl('https://user:pass@mcp.example.com/')).toThrow(
      /credentials/,
    );
  });

  it.each([
    'https://localhost/mcp',
    'https://foo.localhost/mcp',
    'https://127.0.0.1/mcp',
    'https://10.0.0.4/mcp',
    'https://192.168.1.9/mcp',
    'https://172.16.0.2/mcp',
    'https://169.254.169.254/mcp',
    'https://[::1]/mcp',
    'https://[::ffff:127.0.0.1]/mcp',
    'https://[fc00::1]/mcp',
    'https://[fd12:3456:789a::1]/mcp',
    'https://[fe80::1]/mcp',
    'https://[::]/mcp',
    'https://[64:ff9b::7f00:1]/mcp',
    'https://[64:ff9b::6440:1]/mcp',
    'https://[64:ff9b:1::a9fe:a9fe]/mcp',
    'https://[2002:7f00:1::]/mcp',
    'https://[2001:db8::1]/mcp',
    'https://[100::1]/mcp',
    'https://100.64.0.1/mcp',
    'https://100.127.255.255/mcp',
    'https://192.0.2.1/mcp',
    'https://198.51.100.1/mcp',
    'https://203.0.113.1/mcp',
    'https://198.18.0.1/mcp',
    'https://224.0.0.1/mcp',
    'https://0.0.0.0/mcp',
    'https://255.255.255.255/mcp',
    'https://metadata.google.internal/mcp',
    'https://kubernetes.default.svc/mcp',
    'https://printer.local/mcp',
    'https://secret.internal/mcp',
    'https://house.home.arpa/mcp',
  ])('rejects private host %s', (url) => {
    expect(() => assertPublicHttpsUrl(url)).toThrow(/local or private/);
  });

  it('does not treat public hostnames as IPv6 unique-local addresses', () => {
    expect(assertPublicHttpsUrl('https://feedback.example.com/mcp')).toBe(
      'https://feedback.example.com/mcp',
    );
  });

  it('classifies dotted IPv4 embeddings inside IPv6 addresses', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIp('64:ff9b::127.0.0.1')).toBe(true);
    expect(isBlockedIp('64:ff9b::8.8.8.8')).toBe(false);
    expect(isBlockedIp('::8.8.8.8')).toBe(false);
  });

  it('allows a public address embedded in NAT64', () => {
    expect(assertPublicHttpsUrl('https://[64:ff9b::808:808]/mcp')).toBe(
      'https://[64:ff9b::808:808]/mcp',
    );
  });

  it('allows a public IPv6 literal and an address outside CGNAT', () => {
    expect(assertPublicHttpsUrl('https://[2606:4700:4700::1111]/mcp')).toBe(
      'https://[2606:4700:4700::1111]/mcp',
    );
    expect(assertPublicHttpsUrl('https://100.128.0.1/mcp')).toBe('https://100.128.0.1/mcp');
  });

  describe('resolvePinnedAddress', () => {
    beforeEach(() => {
      lookup.mockReset();
    });

    it('pins a literal without a DNS lookup', async () => {
      await expect(resolvePinnedAddress('https://1.1.1.1/mcp')).resolves.toEqual({
        address: '1.1.1.1',
        family: 4,
      });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('rejects a name when any resolved address is private', async () => {
      lookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]);

      await expect(resolvePinnedAddress('https://127.0.0.1.nip.io/mcp')).rejects.toThrow(
        /local or private/,
      );
    });

    it('pins the first address when every resolved address is public', async () => {
      lookup.mockResolvedValue([
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '1.1.1.1', family: 4 },
      ]);

      await expect(resolvePinnedAddress('https://mcp.example.com/mcp')).resolves.toEqual({
        address: '2606:4700:4700::1111',
        family: 6,
      });
    });

    it('reports a resolution failure without the resolver error', async () => {
      lookup.mockRejectedValue(new Error('ENOTFOUND secret.example'));

      await expect(resolvePinnedAddress('https://secret.example/mcp')).rejects.toThrow(
        'Could not resolve the MCP server URL',
      );
    });
  });
});
