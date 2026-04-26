import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino, { multistream, type Logger } from 'pino';
import { sanitizeForLogs, serializeError } from './sanitize.js';
import { setDefaultLogger } from './context.js';
import { getActiveTraceMetadata } from './tracing.js';
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

function isFileLoggingEnabled(): boolean {
  const raw = process.env['LOG_FILE_ENABLED'];
  if (typeof raw === 'string') {
    return raw === '1' || raw.toLowerCase() === 'true';
  }

  return process.env.NODE_ENV !== 'production';
}

function resolveLokiEndpoint(): string | null {
  const raw = process.env['LOG_LOKI_ENDPOINT'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
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
      typeof parsed.traceId === 'string' ? `traceId=${parsed.traceId}` : null,
      typeof parsed.spanId === 'string' ? `spanId=${parsed.spanId}` : null,
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
    delete rest.traceId;
    delete rest.spanId;
    delete rest.userId;
    delete rest.jobId;

    const suffix = Object.keys(rest).length > 0 ? ` ${JSON.stringify(sanitizeForLogs(rest))}` : '';

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

class LokiBatchStream extends Writable {
  private readonly buffer: Array<[string, string]> = [];

  private flushTimer: NodeJS.Timeout | null = null;

  private flushing = false;

  constructor(
    private readonly endpoint: string,
    private readonly labels: Record<string, string>,
  ) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.buffer.push([`${Date.now()}000000`, String(chunk).trimEnd()]);
    if (this.buffer.length >= 25) {
      void this.flush();
    } else if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, 250);
      this.flushTimer.unref();
    }
    callback();
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    void this.flush().finally(() => callback());
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    const values = this.buffer.splice(0, this.buffer.length);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          streams: [
            {
              stream: this.labels,
              values,
            },
          ],
        }),
      });

      if (!response.ok) {
        process.stderr.write(
          `Loki log export failed with status ${response.status} ${response.statusText}\n`,
        );
      }
    } catch (error) {
      process.stderr.write(
        `Loki log export failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    } finally {
      this.flushing = false;
      if (this.buffer.length > 0) {
        void this.flush();
      }
    }
  }
}

function createLoggerDestination(service: string, format: 'pretty' | 'json', logDirectory: string) {
  const streams: Array<{ stream: Writable | NodeJS.WriteStream }> = [];

  if (format === 'json') {
    streams.push({ stream: process.stdout });
  } else {
    streams.push({ stream: new PrettyConsoleStream() });
  }

  if (isFileLoggingEnabled()) {
    fs.mkdirSync(logDirectory, { recursive: true });
    const fileStream = fs.createWriteStream(path.join(logDirectory, `${service}.ndjson`), {
      flags: 'a',
    });
    streams.push({ stream: fileStream });
  }

  const lokiEndpoint = resolveLokiEndpoint();
  if (lokiEndpoint) {
    streams.push({
      stream: new LokiBatchStream(lokiEndpoint, {
        service,
        environment: process.env['NODE_ENV'] ?? 'development',
      }),
    });
  }

  return multistream(streams);
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
            const traceMetadata = getActiveTraceMetadata();
            args[0] = sanitizeForLogs({
              ...args[0],
              ...(traceMetadata.traceId ? traceMetadata : {}),
            });
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
