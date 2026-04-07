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

function extractErrorDetail(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string | { message?: string; status?: string };
      error_description?: string;
      message?: string;
    };
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return parsed.error;
    }
    if (parsed.error && typeof parsed.error === 'object') {
      if (typeof parsed.error.message === 'string' && parsed.error.message.length > 0) {
        return parsed.error.message;
      }
      if (typeof parsed.error.status === 'string' && parsed.error.status.length > 0) {
        return parsed.error.status;
      }
    }
    if (typeof parsed.error_description === 'string' && parsed.error_description.length > 0) {
      return parsed.error_description;
    }
    if (typeof parsed.message === 'string' && parsed.message.length > 0) {
      return parsed.message;
    }
  } catch {
    // Fall back to the raw response body when the provider does not return JSON.
  }

  return trimmed.replace(/\s+/g, ' ').slice(0, 300);
}

async function performRequest(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  const response = await fetchWithTelemetry(input, init, {
    component: 'knowledge-source-http',
    provider: inferProvider(url.hostname),
    eventPrefix: 'knowledge_source.http',
    logResponseBodyOnFailure: false,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = extractErrorDetail(body);
    throw new Error(
      detail
        ? `HTTP ${response.status}: ${response.statusText || 'Request failed'} - ${detail}`
        : `HTTP ${response.status}: ${response.statusText || 'Request failed'}`,
    );
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
