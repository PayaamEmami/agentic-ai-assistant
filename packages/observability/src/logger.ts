import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino, { multistream, type Logger } from 'pino';
import { sanitizeForLogs, serializeError } from './sanitize.js';
import { setDefaultLogger } from './context.js';
import type { ServiceLoggerOptions } from './types.js';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'cookie',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'token',
  'password',
  'secret',
];

function resolveFormat(format?: 'pretty' | 'json'): 'pretty' | 'json' {
  if (format) {
    return format;
  }

  if (process.env['LOG_FORMAT'] === 'pretty' || process.env['LOG_FORMAT'] === 'json') {
    return process.env['LOG_FORMAT'];
  }

  return process.env.NODE_ENV === 'development' ? 'pretty' : 'json';
}

function levelLabel(level: unknown): string {
  if (typeof level === 'string') {
    return level.toUpperCase();
  }

  if (typeof level !== 'number') {
    return 'INFO';
  }

  if (level >= 60) return 'FATAL';
  if (level >= 50) return 'ERROR';
  if (level >= 40) return 'WARN';
  if (level >= 30) return 'INFO';
  if (level >= 20) return 'DEBUG';
  return 'TRACE';
}

function formatPrettyLine(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const message = typeof parsed.msg === 'string' ? parsed.msg : '';
    const time =
      typeof parsed.time === 'string'
        ? parsed.time
        : new Date(typeof parsed.time === 'number' ? parsed.time : Date.now()).toISOString();
    const tags = [
      typeof parsed.service === 'string' ? `service=${parsed.service}` : null,
      typeof parsed.component === 'string' ? `component=${parsed.component}` : null,
      typeof parsed.event === 'string' ? `event=${parsed.event}` : null,
      typeof parsed.outcome === 'string' ? `outcome=${parsed.outcome}` : null,
      typeof parsed.requestId === 'string' ? `requestId=${parsed.requestId}` : null,
      typeof parsed.correlationId === 'string' ? `correlationId=${parsed.correlationId}` : null,
      typeof parsed.userId === 'string' ? `userId=${parsed.userId}` : null,
      typeof parsed.jobId === 'string' ? `jobId=${parsed.jobId}` : null,
    ].filter((entry): entry is string => entry !== null);

    const rest = { ...parsed };
    delete rest.level;
    delete rest.time;
    delete rest.msg;
    delete rest.pid;
    delete rest.hostname;
    delete rest.service;
    delete rest.component;
    delete rest.event;
    delete rest.outcome;
    delete rest.requestId;
    delete rest.correlationId;
    delete rest.userId;
    delete rest.jobId;

    const suffix =
      Object.keys(rest).length > 0
        ? ` ${JSON.stringify(sanitizeForLogs(rest))}`
        : '';

    const tagText = tags.length > 0 ? ` ${tags.join(' ')}` : '';
    return `${time} ${levelLabel(parsed.level)}${tagText}${message ? ` ${message}` : ''}${suffix}`;
  } catch {
    return raw.trimEnd();
  }
}

class PrettyConsoleStream extends Writable {
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    process.stdout.write(`${formatPrettyLine(String(chunk))}\n`);
    callback();
  }
}

function createLoggerDestination(service: string, format: 'pretty' | 'json', logDirectory: string) {
  fs.mkdirSync(logDirectory, { recursive: true });
  const fileStream = fs.createWriteStream(path.join(logDirectory, `${service}.ndjson`), {
    flags: 'a',
  });

  if (format === 'json') {
    return multistream([
      { stream: process.stdout },
      { stream: fileStream },
    ]);
  }

  return multistream([
    { stream: new PrettyConsoleStream() },
    { stream: fileStream },
  ]);
}

export function createServiceLogger(options: ServiceLoggerOptions): Logger {
  const format = resolveFormat(options.format);
  const logDirectory = options.logDirectory ?? path.join(process.cwd(), '.logs');
  const destination = createLoggerDestination(options.service, format, logDirectory);

  const logger = pino(
    {
      level: options.level ?? process.env.LOG_LEVEL ?? 'info',
      base: {
        service: options.service,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: REDACT_PATHS,
        censor: '[Redacted]',
      },
      serializers: {
        err: serializeError,
        error: serializeError,
      },
      hooks: {
        logMethod(args, method) {
          if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
            args[0] = sanitizeForLogs(args[0]);
          }
          method.apply(this, args);
        },
      },
    },
    destination,
  );

  setDefaultLogger(logger);
  return logger;
}
