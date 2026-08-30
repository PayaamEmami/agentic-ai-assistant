import { getPool } from '@aaa/db';
import type { AutomationRunActivityEvent, AutomationRunStatusEvent } from '@aaa/shared';
import { logger } from '../../lib/logger.js';
import { broadcast } from '../../ws/connections.js';

const CHANNEL = 'automation_run_events';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

interface NotificationLike {
  channel?: string;
  payload?: string;
}

interface ListenerClient {
  query: (sql: string) => Promise<unknown>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  removeAllListeners: (event?: string) => void;
  release: () => void;
}

let listenerClient: ListenerClient | null = null;
let stopped = true;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = RECONNECT_MIN_MS;

function isAutomationStatusEvent(event: unknown): event is AutomationRunStatusEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }

  const candidate = event as Partial<AutomationRunStatusEvent>;
  return (
    candidate.type === 'automation.run.status' &&
    typeof candidate.conversationId === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.status === 'string'
  );
}

function isAutomationActivityEvent(event: unknown): event is AutomationRunActivityEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }

  const candidate = event as Partial<AutomationRunActivityEvent>;
  return (
    candidate.type === 'automation.run.event' &&
    typeof candidate.conversationId === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.seq === 'number' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.message === 'string'
  );
}

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function releaseClient(client: ListenerClient): void {
  try {
    client.removeAllListeners();
    client.release();
  } catch {
    // The socket is already gone; releasing is best-effort.
  }
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) {
    return;
  }

  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void listen().catch((error) => {
      logger.warn(
        {
          event: 'automation.event_relay.reconnect_failed',
          outcome: 'failure',
          component: 'automation-event-relay',
          error,
        },
        'Failed to reconnect the automation event relay',
      );
      scheduleReconnect();
    });
  }, delay);
}

async function listen(): Promise<void> {
  if (stopped) {
    return;
  }

  const rawClient = await getPool().connect();
  const client = rawClient as unknown as ListenerClient;

  try {
    await client.query(`LISTEN ${CHANNEL}`);
  } catch (error) {
    releaseClient(client);
    throw error;
  }
  client.on('notification', (...args: unknown[]) => {
    const message = args[0] as NotificationLike;
    if (message.channel !== CHANNEL || !message.payload) {
      return;
    }

    try {
      const parsed = JSON.parse(message.payload) as unknown;
      if (isAutomationStatusEvent(parsed) || isAutomationActivityEvent(parsed)) {
        broadcast(parsed.conversationId, parsed);
      }
    } catch (error) {
      logger.warn(
        {
          event: 'automation.event_relay.notification_failed',
          outcome: 'failure',
          component: 'automation-event-relay',
          error,
        },
        'Failed to process automation run event notification',
      );
    }
  });

  const onDisconnect = () => {
    if (listenerClient !== client) {
      return;
    }

    listenerClient = null;
    releaseClient(client);
    logger.warn(
      {
        event: 'automation.event_relay.disconnected',
        outcome: 'failure',
        component: 'automation-event-relay',
      },
      'Automation event relay disconnected; retrying',
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
  reconnectDelayMs = RECONNECT_MIN_MS;
  logger.info(
    {
      event: 'automation.event_relay.started',
      outcome: 'success',
      component: 'automation-event-relay',
    },
    'Automation event relay started',
  );
}

/**
 * Relays automation run activity from the worker to subscribed browsers.
 *
 * Runs are keyed by their hidden conversation, so this reuses the same
 * per-conversation subscription and authorization the chat stream uses.
 */
export async function startAutomationEventRelay(): Promise<void> {
  if (!stopped && listenerClient) {
    return;
  }

  stopped = false;
  clearReconnect();
  try {
    await listen();
  } catch (error) {
    logger.warn(
      {
        event: 'automation.event_relay.start_failed',
        outcome: 'failure',
        component: 'automation-event-relay',
        error,
      },
      'Failed to start the automation event relay; retrying',
    );
    scheduleReconnect();
  }
}

export async function stopAutomationEventRelay(): Promise<void> {
  stopped = true;
  clearReconnect();

  if (!listenerClient) {
    return;
  }

  const client = listenerClient;
  listenerClient = null;

  try {
    await client.query(`UNLISTEN ${CHANNEL}`);
  } finally {
    releaseClient(client);
    logger.info(
      {
        event: 'automation.event_relay.stopped',
        outcome: 'success',
        component: 'automation-event-relay',
      },
      'Automation event relay stopped',
    );
  }
}
