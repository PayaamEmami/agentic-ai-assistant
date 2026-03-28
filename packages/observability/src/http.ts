import { withSpan } from './tracing.js';
import { getLogger } from './context.js';
import { sanitizeForLogs } from './sanitize.js';
import { outboundRequestCounter, outboundRequestDurationMs } from './metrics.js';

export interface TelemetryFetchOptions {
  component: string;
  provider?: string;
  eventPrefix?: string;
  logResponseBodyOnFailure?: boolean;
}

function safeUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === 'string') {
    return new URL(input);
  }

  return new URL(input.url);
}

function inferProvider(url: URL, provider?: string): string {
  if (provider) {
    return provider;
  }

  return url.hostname;
}

export async function fetchWithTelemetry(
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: TelemetryFetchOptions,
): Promise<Response> {
  const url = safeUrl(input);
  const method = init?.method ?? 'GET';
  const provider = inferProvider(url, options.provider);
  const eventPrefix = options.eventPrefix ?? 'http';
  const logger = getLogger({
    component: options.component,
    provider,
  });
  const startedAt = Date.now();

  return withSpan(
    `${options.component}.${method.toLowerCase()}`,
    {
      'http.method': method,
      'http.url': `${url.origin}${url.pathname}`,
      'http.host': url.host,
      'peer.service': provider,
    },
    async () => {
      logger.debug(
        {
          event: `${eventPrefix}.started`,
          outcome: 'start',
          method,
          provider,
          endpoint: url.pathname,
        },
        'Outbound request started',
      );

      try {
        const response = await fetch(input, init);
        const durationMs = Date.now() - startedAt;
        const outcome = response.ok ? 'success' : 'failure';
        outboundRequestCounter.inc({
          component: options.component,
          provider,
          method,
          outcome,
          status_code: String(response.status),
        });
        outboundRequestDurationMs.observe(
          {
            component: options.component,
            provider,
            method,
            outcome,
          },
          durationMs,
        );

        if (!response.ok) {
          const detail = options.logResponseBodyOnFailure
            ? sanitizeForLogs(await response.clone().text().catch(() => ''))
            : undefined;
          logger.warn(
            {
              event: `${eventPrefix}.failed`,
              outcome,
              method,
              provider,
              endpoint: url.pathname,
              statusCode: response.status,
              durationMs,
              detail: typeof detail === 'string' ? detail.slice(0, 300) : undefined,
            },
            'Outbound request failed',
          );
        } else {
          logger.debug(
            {
              event: `${eventPrefix}.completed`,
              outcome,
              method,
              provider,
              endpoint: url.pathname,
              statusCode: response.status,
              durationMs,
            },
            'Outbound request completed',
          );
        }

        return response;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        outboundRequestCounter.inc({
          component: options.component,
          provider,
          method,
          outcome: 'failure',
          status_code: 'error',
        });
        outboundRequestDurationMs.observe(
          {
            component: options.component,
            provider,
            method,
            outcome: 'failure',
          },
          durationMs,
        );
        logger.error(
          {
            event: `${eventPrefix}.failed`,
            outcome: 'failure',
            method,
            provider,
            endpoint: url.pathname,
            durationMs,
            error,
          },
          'Outbound request threw an error',
        );
        throw error;
      }
    },
  );
}
