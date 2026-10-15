import { getPool } from '@aaa/db';
import { logger as defaultLogger } from './logger.js';

const CHANNEL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_RECONNECT_MIN_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 15_000;

export interface PgNotifyClient {
  query: (sql: string) => Promise<unknown>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  removeAllListeners: (event?: string) => void;
  release: () => void;
}

export interface PgNotifyRelayLogger {
  info: (bindings: Record<string, unknown>, message: string) => void;
  warn: (bindings: Record<string, unknown>, message: string) => void;
}

export interface PgNotifyRelayTimers {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface PgNotifyRelayOptions {
  channel: string;
  component: string;
  eventPrefix: string;
  label: string;
  onPayload: (payload: unknown) => void;
  connect?: () => Promise<PgNotifyClient>;
  logger?: PgNotifyRelayLogger;
  timers?: PgNotifyRelayTimers;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

export interface PgNotifyRelay {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface NotificationLike {
  channel?: string;
  payload?: string;
}

function defaultConnect(): Promise<PgNotifyClient> {
  return getPool().connect() as unknown as Promise<PgNotifyClient>;
}

function defaultTimers(): PgNotifyRelayTimers {
  return {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

function assertChannelName(channel: string): void {
  if (!CHANNEL_NAME_PATTERN.test(channel)) {
    throw new Error(`Invalid Postgres NOTIFY channel: ${channel}`);
  }
}

function releaseClient(client: PgNotifyClient): void {
  try {
    client.removeAllListeners();
    client.release();
  } catch {
    // The socket is already gone; releasing is best-effort.
  }
}

/**
 * Dedicated LISTEN client that forwards pg_notify payloads to the API process.
 *
 * Worker jobs publish onto Postgres channels; this keeps a single connection
 * subscribed and reconnects with backoff when that socket drops. Callers still
 * own payload validation and WebSocket fan-out.
 */
export function createPgNotifyRelay(options: PgNotifyRelayOptions): PgNotifyRelay {
  assertChannelName(options.channel);

  const reconnectMinMs = options.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS;
  const reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
  const connect = options.connect ?? defaultConnect;
  const log: PgNotifyRelayLogger = options.logger ?? defaultLogger;
  const timers = options.timers ?? defaultTimers();
  const { channel, component, eventPrefix, label, onPayload } = options;

  let listenerClient: PgNotifyClient | null = null;
  let stopped = true;
  let reconnectTimer: unknown = null;
  let reconnectDelayMs = reconnectMinMs;

  function clearReconnect(): void {
    if (reconnectTimer !== null) {
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer !== null) {
      return;
    }

    const delay = reconnectDelayMs;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, reconnectMaxMs);
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      void listen().catch((error) => {
        log.warn(
          {
            event: `${eventPrefix}.reconnect_failed`,
            outcome: 'failure',
            component,
            error,
          },
          `Failed to reconnect the ${label}`,
        );
        scheduleReconnect();
      });
    }, delay);
  }

  async function listen(): Promise<void> {
    if (stopped) {
      return;
    }

    const client = await connect();

    try {
      await client.query(`LISTEN ${channel}`);
    } catch (error) {
      releaseClient(client);
      throw error;
    }

    client.on('notification', (...args: unknown[]) => {
      const message = args[0] as NotificationLike;
      if (message.channel !== channel || !message.payload) {
        return;
      }

      try {
        onPayload(JSON.parse(message.payload) as unknown);
      } catch (error) {
        log.warn(
          {
            event: `${eventPrefix}.notification_failed`,
            outcome: 'failure',
            component,
            error,
          },
          `Failed to process ${label} notification`,
        );
      }
    });

    const onDisconnect = () => {
      if (listenerClient !== client) {
        return;
      }

      listenerClient = null;
      releaseClient(client);
      log.warn(
        {
          event: `${eventPrefix}.disconnected`,
          outcome: 'failure',
          component,
        },
        `${capitalize(label)} disconnected; retrying`,
      );
      scheduleReconnect();
    };

    client.on('error', onDisconnect);
    client.on('end', onDisconnect);

    if (stopped) {
      releaseClient(client);
      return;
    }

    listenerClient = client;
    reconnectDelayMs = reconnectMinMs;
    log.info(
      {
        event: `${eventPrefix}.started`,
        outcome: 'success',
        component,
      },
      `${capitalize(label)} started`,
    );
  }

  async function start(): Promise<void> {
    if (!stopped && listenerClient) {
      return;
    }

    stopped = false;
    clearReconnect();
    try {
      await listen();
    } catch (error) {
      log.warn(
        {
          event: `${eventPrefix}.start_failed`,
          outcome: 'failure',
          component,
          error,
        },
        `Failed to start the ${label}; retrying`,
      );
      scheduleReconnect();
    }
  }

  async function stop(): Promise<void> {
    stopped = true;
    clearReconnect();

    if (!listenerClient) {
      return;
    }

    const client = listenerClient;
    listenerClient = null;

    try {
      await client.query(`UNLISTEN ${channel}`);
    } finally {
      releaseClient(client);
      log.info(
        {
          event: `${eventPrefix}.stopped`,
          outcome: 'success',
          component,
        },
        `${capitalize(label)} stopped`,
      );
    }
  }

  return { start, stop };
}

function capitalize(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value[0]!.toUpperCase() + value.slice(1);
}
