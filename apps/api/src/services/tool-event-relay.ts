import { getPool } from '@aaa/db';
import type { ToolDoneEvent, ToolStartEvent } from '@aaa/shared';
import { logger } from '../lib/logger.js';
import { broadcast } from '../ws/connections.js';

const CHANNEL = 'tool_execution_events';

interface NotificationLike {
  channel?: string;
  payload?: string;
}

interface ListenerClient {
  query: (sql: string) => Promise<unknown>;
  on: (event: 'notification', cb: (message: NotificationLike) => void) => void;
  removeAllListeners: (event: 'notification') => void;
  release: () => void;
}

let listenerClient: ListenerClient | null = null;

function isToolStartEvent(event: unknown): event is ToolStartEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const candidate = event as Partial<ToolStartEvent>;
  return (
    candidate.type === 'tool.start' &&
    typeof candidate.conversationId === 'string' &&
    typeof candidate.toolExecutionId === 'string' &&
    typeof candidate.toolName === 'string'
  );
}

function isToolDoneEvent(event: unknown): event is ToolDoneEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const candidate = event as Partial<ToolDoneEvent>;
  return (
    candidate.type === 'tool.done' &&
    typeof candidate.conversationId === 'string' &&
    typeof candidate.toolExecutionId === 'string' &&
    typeof candidate.toolName === 'string' &&
    (candidate.status === 'completed' || candidate.status === 'failed')
  );
}

export async function startToolEventRelay(): Promise<void> {
  if (listenerClient) {
    return;
  }

  const rawClient = await getPool().connect();
  const client = rawClient as unknown as ListenerClient;
  await client.query(`LISTEN ${CHANNEL}`);
  client.on('notification', (message: NotificationLike) => {
    if (message.channel !== CHANNEL || !message.payload) {
      return;
    }

    try {
      const parsed = JSON.parse(message.payload) as unknown;
      if (isToolStartEvent(parsed)) {
        broadcast(parsed.conversationId, parsed);
        return;
      }

      if (isToolDoneEvent(parsed)) {
        broadcast(parsed.conversationId, parsed);
      }
    } catch (error) {
      logger.warn(
        {
          event: 'tool.event_relay.notification_failed',
          outcome: 'failure',
          component: 'tool-event-relay',
          error,
        },
        'Failed to process tool event notification',
      );
    }
  });

  listenerClient = client;
  logger.info(
    {
      event: 'tool.event_relay.started',
      outcome: 'success',
      component: 'tool-event-relay',
    },
    'Tool event relay started',
  );
}

export async function stopToolEventRelay(): Promise<void> {
  if (!listenerClient) {
    return;
  }

  try {
    await listenerClient.query(`UNLISTEN ${CHANNEL}`);
  } finally {
    listenerClient.removeAllListeners('notification');
    listenerClient.release();
    listenerClient = null;
    logger.info(
      {
        event: 'tool.event_relay.stopped',
        outcome: 'success',
        component: 'tool-event-relay',
      },
      'Tool event relay stopped',
    );
  }
}
