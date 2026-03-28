'use client';

import { API_BASE, ApiError, getStoredAuthToken } from './api-client';
import { getClientSessionId } from './client-observability';
import type { Metric } from 'web-vitals';

type ClientLogLevel = 'warn' | 'error';

interface ClientLogEntry {
  level: ClientLogLevel;
  event: string;
  component: string;
  message: string;
  requestId?: string;
  correlationId?: string;
  clientSessionId?: string;
  conversationId?: string;
  voiceSessionId?: string;
  context?: Record<string, unknown>;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_KEY = 10;
const rateLimitState = new Map<string, { count: number; windowStartedAt: number }>();

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) {
    return '[Truncated]';
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 600 ? `${value.slice(0, 600)}...[truncated]` : value;
  }

  if (value instanceof Error) {
    const apiError = value instanceof ApiError ? value : null;
    return {
      name: value.name,
      message: value.message,
      requestId: apiError?.requestId,
      correlationId: apiError?.correlationId,
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeValue(entry, depth + 1),
      ]),
    );
  }

  return String(value);
}

function isRateLimited(event: string, component: string): boolean {
  const key = `${component}:${event}`;
  const now = Date.now();
  const current = rateLimitState.get(key);
  if (!current || now - current.windowStartedAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(key, { count: 1, windowStartedAt: now });
    return false;
  }

  if (current.count >= RATE_LIMIT_MAX_PER_KEY) {
    return true;
  }

  current.count += 1;
  return false;
}

function buildPayload(entry: ClientLogEntry) {
  return {
    logs: [
      {
        level: entry.level,
        event: entry.event,
        component: entry.component,
        message: entry.message,
        requestId: entry.requestId,
        correlationId: entry.correlationId,
        clientSessionId: entry.clientSessionId ?? getClientSessionId(),
        conversationId: entry.conversationId,
        voiceSessionId: entry.voiceSessionId,
        context: sanitizeValue(entry.context ?? {}) as Record<string, unknown>,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export async function reportClientLog(entry: ClientLogEntry): Promise<void> {
  if (typeof window === 'undefined' || isRateLimited(entry.event, entry.component)) {
    return;
  }

  const payload = buildPayload(entry);
  const token = getStoredAuthToken();
  const body = JSON.stringify(payload);

  try {
    if (!token && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(
        `${API_BASE}/api/client-logs`,
        new Blob([body], { type: 'application/json' }),
      );
      return;
    }

    await fetch(`${API_BASE}/api/client-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      keepalive: true,
    });
  } catch {
    // Logging failures must never break the user flow.
  }
}

export async function reportClientError(input: {
  event: string;
  component: string;
  message: string;
  error?: unknown;
  requestId?: string;
  correlationId?: string;
  clientSessionId?: string;
  conversationId?: string;
  voiceSessionId?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  await reportClientLog({
    level: 'error',
    event: input.event,
    component: input.component,
    message: input.message,
    requestId: input.requestId,
    correlationId: input.correlationId,
    clientSessionId: input.clientSessionId ?? getClientSessionId(),
    conversationId: input.conversationId,
    voiceSessionId: input.voiceSessionId,
    context: {
      ...input.context,
      error: input.error,
    },
  });
}

export async function reportWebVital(metric: Metric): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = {
    metrics: [
      {
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        id: metric.id,
        clientSessionId: getClientSessionId(),
        route: window.location.pathname,
        url: window.location.href,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    await fetch(`${API_BASE}/api/client-telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Telemetry failures must never break the user flow.
  }
}

let installedGlobalHandlers = false;

export function installGlobalClientErrorHandlers(): void {
  if (installedGlobalHandlers || typeof window === 'undefined') {
    return;
  }

  installedGlobalHandlers = true;

  window.addEventListener('error', (event) => {
    void reportClientError({
      event: 'client.window.error',
      component: 'global-error-handler',
      message: event.message || 'Unhandled window error',
      error: event.error,
      context: {
        fileName: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    void reportClientError({
      event: 'client.window.unhandled_rejection',
      component: 'global-error-handler',
      message: 'Unhandled promise rejection',
      error: event.reason,
    });
  });
}
