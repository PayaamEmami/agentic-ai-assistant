import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPinned } from './pinned-fetch.js';
import { McpError } from './types.js';

const lookup = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup,
}));

vi.mock('node:https', () => ({
  request,
}));

function succeed(body: string) {
  request.mockImplementation((options: RequestOptions, callback: (res: IncomingMessage) => void) => {
    const req = new EventEmitter();
    const end = () => {
      const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        resume: () => undefined,
      }) as unknown as IncomingMessage;
      callback(res);
      queueMicrotask(() => {
        res.emit('data', Buffer.from(body));
        res.emit('end');
      });
    };
    return Object.assign(req, { end, destroy: () => req });
  });
}

describe('fetchPinned', () => {
  beforeEach(() => {
    lookup.mockReset();
    request.mockReset();
  });

  it('connects to the checked address instead of looking the name up again', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    succeed('ok');

    const response = await fetchPinned('https://mcp.example.com/mcp', {
      method: 'POST',
      body: '{}',
    });

    expect(await response.text()).toBe('ok');
    expect(request).toHaveBeenCalledOnce();
    const options = request.mock.calls[0]?.[0] as RequestOptions;
    expect(options.hostname).toBe('mcp.example.com');
    expect(options.servername).toBe('mcp.example.com');
    expect(options.agent).toBe(false);

    const pinned: string[] = [];
    options.lookup?.('mcp.example.com', { all: true }, (error, addresses) => {
      expect(error).toBeNull();
      if (Array.isArray(addresses)) {
        pinned.push(...addresses.map((entry) => entry.address));
      }
    });
    expect(pinned).toEqual(['93.184.216.34']);
  });

  it('does not connect when a resolved address is private', async () => {
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.4', family: 4 },
    ]);

    await expect(fetchPinned('https://rebind.example/mcp')).rejects.toBeInstanceOf(McpError);
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a redirect instead of following it', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    request.mockImplementation((_options: RequestOptions, callback: (res: IncomingMessage) => void) => {
      const req = new EventEmitter();
      const end = () => {
        const res = Object.assign(new EventEmitter(), {
          statusCode: 302,
          headers: { location: 'https://127.0.0.1/mcp' },
          resume: () => undefined,
        }) as unknown as IncomingMessage;
        callback(res);
        queueMicrotask(() => res.emit('end'));
      };
      return Object.assign(req, { end, destroy: () => req });
    });

    await expect(fetchPinned('https://mcp.example.com/mcp')).rejects.toThrow(/cannot redirect/);
  });
});
