import { getLogger } from '@aaa/observability';

function toUrlString(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function inferProvider(hostname: string): string {
  if (hostname.includes('google')) {
    return 'google';
  }

  if (hostname.includes('github')) {
    return 'github';
  }

  return hostname;
}

async function performRequest(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  const method = init?.method ?? 'GET';
  const logger = getLogger({
    component: 'connector-http',
    provider: inferProvider(url.hostname),
  });
  const startedAt = Date.now();

  logger.debug(
    {
      event: 'connector.http.started',
      outcome: 'start',
      method,
      endpoint: url.pathname,
    },
    'Connector HTTP request started',
  );

  const response = await fetch(input, init);
  const durationMs = Date.now() - startedAt;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.warn(
      {
        event: 'connector.http.failed',
        outcome: 'failure',
        method,
        endpoint: url.pathname,
        statusCode: response.status,
        durationMs,
        detail: body.slice(0, 500),
      },
      'Connector HTTP request failed',
    );
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }

  logger.debug(
    {
      event: 'connector.http.completed',
      outcome: 'success',
      method,
      endpoint: url.pathname,
      statusCode: response.status,
      durationMs,
    },
    'Connector HTTP request completed',
  );

  return response;
}

export async function requestJson<T>(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<T> {
  const response = await performRequest(toUrlString(input), init);
  return response.json() as Promise<T>;
}

export async function requestText(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<string> {
  const response = await performRequest(toUrlString(input), init);
  return response.text();
}
