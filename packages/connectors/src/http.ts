import { fetchWithTelemetry } from '@aaa/observability';

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
  const response = await fetchWithTelemetry(input, init, {
    component: 'connector-http',
    provider: inferProvider(url.hostname),
    eventPrefix: 'connector.http',
    logResponseBodyOnFailure: false,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${response.statusText || (body ? 'Request failed' : 'Request failed')}`);
  }

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
