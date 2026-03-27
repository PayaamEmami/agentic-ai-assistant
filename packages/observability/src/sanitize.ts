import type { SerializedError } from './types.js';

const SENSITIVE_SEGMENTS = [
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'apikey',
  'accesskey',
  'clientsecret',
  'credentials',
  'bearer',
  'sdp',
  'transcript',
  'prompt',
];

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_SEGMENTS.some((segment) => normalized.includes(segment));
}

function sanitizeString(value: string): string {
  if (/bearer\s+[a-z0-9._-]+/i.test(value)) {
    return value.replace(/bearer\s+[a-z0-9._-]+/gi, 'Bearer [Redacted]');
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function sanitizeForLogs<T>(value: T, depth = 0): T {
  if (depth > 4) {
    return '[Truncated]' as T;
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
    return sanitizeString(value) as T;
  }

  if (value instanceof Error) {
    return serializeError(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogs(entry, depth + 1)) as T;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (isSensitiveKey(key)) {
        return [key, '[Redacted]'] as const;
      }

      return [key, sanitizeForLogs(entry, depth + 1)] as const;
    });

    return Object.fromEntries(entries) as T;
  }

  return String(value) as T;
}

export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    if (isRecord(error)) {
      const name =
        typeof error.name === 'string' && error.name.trim().length > 0
          ? sanitizeString(error.name)
          : 'UnknownError';
      const message =
        typeof error.message === 'string' && error.message.trim().length > 0
          ? sanitizeString(error.message)
          : 'Non-Error value thrown';

      const result: SerializedError = { name, message };

      if (typeof error.code === 'string') {
        result.code = sanitizeString(error.code);
      }

      if (typeof error.statusCode === 'number') {
        result.statusCode = error.statusCode;
      }

      if (typeof error.stack === 'string') {
        result.stack = sanitizeString(error.stack);
      }

      if (typeof error.cause !== 'undefined') {
        result.cause = serializeError(error.cause);
      }

      const details = Object.fromEntries(
        Object.entries(error).filter(([key]) => !['name', 'message', 'code', 'statusCode', 'stack', 'cause'].includes(key)),
      );

      if (Object.keys(details).length > 0) {
        result.details = sanitizeForLogs(details);
      }

      return result;
    }

    return {
      name: 'UnknownError',
      message: typeof error === 'string' ? sanitizeString(error) : String(error),
    };
  }

  const result: SerializedError = {
    name: error.name,
    message: sanitizeString(error.message),
  };

  if (typeof error.stack === 'string') {
    result.stack = error.stack;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === 'string') {
    result.code = maybeCode;
  }

  const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof maybeStatusCode === 'number') {
    result.statusCode = maybeStatusCode;
  }

  const maybeCause = (error as { cause?: unknown }).cause;
  if (typeof maybeCause !== 'undefined') {
    result.cause = serializeError(maybeCause);
  }

  return result;
}
