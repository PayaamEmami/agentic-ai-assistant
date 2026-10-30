import { isIP } from 'node:net';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { McpError } from './types.js';
import { resolvePinnedAddress } from './url.js';

function requestBody(body: RequestInit['body']): string | Uint8Array | undefined {
  if (body == null) {
    return undefined;
  }
  if (typeof body === 'string' || body instanceof Uint8Array) {
    return body;
  }
  throw new McpError('The MCP request body must be a string');
}

function outgoingHeaders(
  headers: RequestInit['headers'],
  body: string | Uint8Array | undefined,
): Record<string, string> {
  const source = new Headers(headers);
  if (body !== undefined && !source.has('content-length')) {
    const length = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
    source.set('content-length', String(length));
  }

  const result: Record<string, string> = {};
  source.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * HTTPS request pinned to the addresses checked by `resolvePinnedAddress`.
 * Node's fetch looks the name up again, which would let DNS change to a private
 * address after the check and carry the bearer key there. Redirects are refused
 * so the next hop cannot skip that check either.
 */
export async function fetchPinned(input: string, init?: RequestInit): Promise<Response> {
  if (init?.signal?.aborted) {
    throw init.signal.reason instanceof Error ? init.signal.reason : new Error('The operation was aborted');
  }

  const pin = await resolvePinnedAddress(input);
  if (init?.signal?.aborted) {
    throw init.signal.reason instanceof Error ? init.signal.reason : new Error('The operation was aborted');
  }

  const parsed = new URL(input.trim());
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const ipLiteral = isIP(host) !== 0;
  const body = requestBody(init?.body);

  const options: RequestOptions = {
    hostname: ipLiteral ? pin.address : host,
    port: parsed.port === '' ? 443 : Number(parsed.port),
    method: init?.method ?? 'GET',
    path: `${parsed.pathname}${parsed.search}`,
    headers: outgoingHeaders(init?.headers, body),
    agent: false,
    servername: ipLiteral ? undefined : host,
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [{ address: pin.address, family: pin.family }]);
        return;
      }
      callback(null, pin.address, pin.family);
    },
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, response?: Response) => {
      if (settled) {
        return;
      }
      settled = true;
      init?.signal?.removeEventListener('abort', onAbort);
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve(response as Response);
    };

    const req = httpsRequest(options, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        finish(new McpError('The MCP server URL cannot redirect'));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) {
            continue;
          }
          for (const entry of Array.isArray(value) ? value : [value]) {
            headers.append(key, entry);
          }
        }
        finish(undefined, new Response(Buffer.concat(chunks), { status, headers }));
      });
      res.on('error', (error) => finish(error));
    });

    const onAbort = () => {
      const reason = init?.signal?.reason;
      req.destroy(reason instanceof Error ? reason : undefined);
    };

    if (init?.signal) {
      init.signal.addEventListener('abort', onAbort, { once: true });
    }

    req.on('error', (error) => finish(error));
    if (body === undefined) {
      req.end();
    } else {
      req.end(body);
    }
  });
}
