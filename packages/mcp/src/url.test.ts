import { describe, expect, it } from 'vitest';
import { McpError } from './types.js';
import { assertPublicHttpsUrl } from './url.js';

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
    'https://metadata.google.internal/mcp',
    'https://kubernetes.default.svc/mcp',
  ])('rejects private host %s', (url) => {
    expect(() => assertPublicHttpsUrl(url)).toThrow(/local or private/);
  });

  it('does not treat public hostnames as IPv6 unique-local addresses', () => {
    expect(assertPublicHttpsUrl('https://feedback.example.com/mcp')).toBe(
      'https://feedback.example.com/mcp',
    );
  });
});
