import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpClient, unwrapMcpToolData } from './client.js';
import { McpError, McpToolError } from './types.js';

const SERVER_URL = 'https://mcp.example.com/';

interface StubResponse {
  status?: number;
  body?: unknown;
  raw?: string;
}

function jsonResponse({ status = 200, body, raw }: StubResponse): Response {
  const text = raw ?? JSON.stringify(body ?? {});
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(responses: StubResponse[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];

  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) {
      throw new Error('Unexpected extra fetch call');
    }
    return jsonResponse(next);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function client(): McpClient {
  return new McpClient({ serverUrl: SERVER_URL, apiKey: 'tak_test' });
}

function parseBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('McpClient construction', () => {
  it('requires a server URL', () => {
    expect(() => new McpClient({ serverUrl: '', apiKey: 'k' })).toThrow(McpError);
  });

  it('requires a public https URL', () => {
    expect(() => new McpClient({ serverUrl: 'http://mcp.example.com/', apiKey: 'k' })).toThrow(
      /https:\/\//,
    );
    expect(() => new McpClient({ serverUrl: 'https://localhost/mcp', apiKey: 'k' })).toThrow(
      /local or private/,
    );
  });

  it('requires an API key', () => {
    expect(() => new McpClient({ serverUrl: SERVER_URL, apiKey: '' })).toThrow(
      McpError,
    );
  });
});

describe('initialize', () => {
  it('sends the handshake and returns server info', async () => {
    const { calls } = stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'tools-tasks', version: '1.0.0' },
          },
        },
      },
    ]);

    const result = await client().initialize();

    expect(result.serverInfo).toEqual({ name: 'tools-tasks', version: '1.0.0' });
    expect(result.protocolVersion).toBe('2025-06-18');

    const body = parseBody(calls[0]!.init);
    expect(body.method).toBe('initialize');
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
  });

  it('sends the API key as a bearer token', async () => {
    const { calls } = stubFetch([
      { body: { jsonrpc: '2.0', id: 1, result: { serverInfo: {} } } },
    ]);

    await client().initialize();

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tak_test');
    expect(headers['MCP-Protocol-Version']).toBe('2025-06-18');
    expect(calls[0]!.init.redirect).toBe('error');
  });

  it('tolerates a sparse initialize result', async () => {
    stubFetch([{ body: { jsonrpc: '2.0', id: 1, result: {} } }]);

    const result = await client().initialize();

    expect(result.serverInfo).toEqual({ name: 'unknown', version: '0.0.0' });
  });

  it('rejects a non-object result', async () => {
    stubFetch([{ body: { jsonrpc: '2.0', id: 1, result: 'nope' } }]);

    await expect(client().initialize()).rejects.toThrow(/malformed initialize/);
  });
});

describe('listTools', () => {
  it('returns the advertised tools', async () => {
    stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            tools: [
              {
                name: 'tasks_list_boards',
                description: 'List boards',
                inputSchema: { type: 'object', properties: {} },
              },
              {
                name: 'tasks_get_board',
                description: 'Read a board',
                inputSchema: { type: 'object', properties: { boardId: {} } },
              },
            ],
          },
        },
      },
    ]);

    const tools = await client().listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      'tasks_list_boards',
      'tasks_get_board',
    ]);
  });

  it('skips entries without a usable name', async () => {
    stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: { tools: [{ description: 'nameless' }, { name: 'ok' }, 'junk'] },
        },
      },
    ]);

    const tools = await client().listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['ok']);
  });

  it('defaults a missing input schema to an empty object schema', async () => {
    stubFetch([
      { body: { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'bare' }] } } },
    ]);

    const [tool] = await client().listTools();

    expect(tool!.inputSchema).toEqual({ type: 'object', properties: {} });
    expect(tool!.description).toBe('');
  });

  it('rejects a malformed tools list', async () => {
    stubFetch([{ body: { jsonrpc: '2.0', id: 1, result: { tools: 'nope' } } }]);

    await expect(client().listTools()).rejects.toThrow(/malformed tools list/);
  });
});

describe('callTool', () => {
  it('parses a JSON text content block into data', async () => {
    const { calls } = stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            isError: false,
            content: [{ type: 'text', text: JSON.stringify({ boards: [] }) }],
          },
        },
      },
    ]);

    const result = await client().callTool('tasks_list_boards', {});

    expect(result.isError).toBe(false);
    expect(result.data).toEqual({ boards: [] });

    const body = parseBody(calls[0]!.init);
    expect(body.method).toBe('tools/call');
    expect(body.params).toEqual({ name: 'tasks_list_boards', arguments: {} });
  });

  it('forwards arguments to the server', async () => {
    const { calls } = stubFetch([
      { body: { jsonrpc: '2.0', id: 1, result: { isError: false, content: [] } } },
    ]);

    await client().callTool('tasks_get_board', { boardId: 'AGENDA' });

    const body = parseBody(calls[0]!.init) as {
      params: { arguments: Record<string, unknown> };
    };
    expect(body.params.arguments).toEqual({ boardId: 'AGENDA' });
  });

  it('throws McpToolError with the server error message when isError is set', async () => {
    stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            isError: true,
            content: [
              { type: 'text', text: JSON.stringify({ error: 'Board "X" does not exist' }) },
            ],
          },
        },
      },
    ]);

    const error = await client()
      .callTool('tasks_get_board', {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpToolError);
    expect((error as McpToolError).message).toBe('Board "X" does not exist');
    expect((error as McpToolError).toolName).toBe('tasks_get_board');
  });

  it('falls back to raw text when a tool error is not JSON', async () => {
    stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: { isError: true, content: [{ type: 'text', text: 'plain failure' }] },
        },
      },
    ]);

    await expect(client().callTool('tasks_get_board', {})).rejects.toThrow(
      /plain failure/,
    );
  });

  it('keeps non-JSON text blocks without setting data', async () => {
    stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: { isError: false, content: [{ type: 'text', text: 'hello' }] },
        },
      },
    ]);

    const result = await client().callTool('tasks_list_boards');

    expect(result.data).toBeUndefined();
    expect(result.content[0]!.text).toBe('hello');
  });
});

describe('error handling', () => {
  it('maps a 401 to a clear key-rejected error', async () => {
    stubFetch([{ status: 401, body: { error: 'Invalid or revoked API key' } }]);

    await expect(client().listTools()).rejects.toThrow(/rejected the API key/);
  });

  it('maps a 403 to a clear key-rejected error', async () => {
    stubFetch([{ status: 403, body: { error: 'missing scope' } }]);

    await expect(client().listTools()).rejects.toThrow(/rejected the API key/);
  });

  it('surfaces a JSON-RPC error object', async () => {
    stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Unknown method "resources/list"' },
        },
      },
    ]);

    await expect(client().listTools()).rejects.toThrow(/Unknown method/);
  });

  it('preserves the JSON-RPC error code', async () => {
    stubFetch([
      { body: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad params' } } },
    ]);

    const error = await client()
      .listTools()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(-32602);
  });

  it('reports a non-JSON response', async () => {
    stubFetch([{ status: 502, raw: '<html>Bad Gateway</html>' }]);

    await expect(client().listTools()).rejects.toThrow(/non-JSON response/);
  });

  it('reports an empty error response by status', async () => {
    stubFetch([{ status: 500, raw: '' }]);

    await expect(client().listTools()).rejects.toThrow(/HTTP 500/);
  });

  it('wraps transport failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    await expect(client().listTools()).rejects.toThrow(/Could not reach the MCP server/);
  });

  it('reports a timeout distinctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const error = new Error('The operation timed out');
        error.name = 'TimeoutError';
        throw error;
      }),
    );

    await expect(client().listTools()).rejects.toThrow(/timed out/);
  });
});

describe('testConnection', () => {
  it('returns server info and the discovered tools', async () => {
    stubFetch([
      {
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: { serverInfo: { name: 'tools-tasks', version: '1.0.0' } },
        },
      },
      {
        body: {
          jsonrpc: '2.0',
          id: 2,
          result: { tools: [{ name: 'tasks_list_boards' }] },
        },
      },
    ]);

    const result = await client().testConnection();

    expect(result.serverInfo.name).toBe('tools-tasks');
    expect(result.tools).toHaveLength(1);
  });

  it('increments the request id across calls', async () => {
    const { calls } = stubFetch([
      { body: { jsonrpc: '2.0', id: 1, result: { serverInfo: {} } } },
      { body: { jsonrpc: '2.0', id: 2, result: { tools: [] } } },
    ]);

    await client().testConnection();

    expect(parseBody(calls[0]!.init).id).toBe(1);
    expect(parseBody(calls[1]!.init).id).toBe(2);
  });
});

describe('unwrapMcpToolData', () => {
  it('prefers parsed JSON data over content blocks', () => {
    expect(
      unwrapMcpToolData({
        content: [{ type: 'text', text: '{"boardId":"AGENDA"}' }],
        isError: false,
        data: { boardId: 'AGENDA', lists: [] },
      }),
    ).toEqual({ boardId: 'AGENDA', lists: [] });
  });

  it('falls back to content blocks when no JSON was parsed', () => {
    const content = [{ type: 'text', text: 'plain' }];
    expect(unwrapMcpToolData({ content, isError: false })).toEqual(content);
  });
});
