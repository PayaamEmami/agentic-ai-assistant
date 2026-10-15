import {
  TOOL_EVENT_CHANNEL,
  type ToolDoneEvent,
  type ToolProgressEvent,
  type ToolStartEvent,
} from '@aaa/shared';
import { createPgNotifyRelay } from '../../lib/pg-notify-relay.js';
import { broadcast } from '../../ws/connections.js';

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

function isToolProgressEvent(event: unknown): event is ToolProgressEvent {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const candidate = event as Partial<ToolProgressEvent>;
  return (
    candidate.type === 'tool.progress' &&
    typeof candidate.conversationId === 'string' &&
    typeof candidate.toolExecutionId === 'string' &&
    typeof candidate.toolName === 'string' &&
    typeof candidate.phase === 'string' &&
    typeof candidate.message === 'string'
  );
}

const relay = createPgNotifyRelay({
  channel: TOOL_EVENT_CHANNEL,
  component: 'tool-event-relay',
  eventPrefix: 'tool.event_relay',
  label: 'tool event relay',
  onPayload: (payload) => {
    if (isToolStartEvent(payload) || isToolDoneEvent(payload) || isToolProgressEvent(payload)) {
      broadcast(payload.conversationId, payload);
    }
  },
});

export async function startToolEventRelay(): Promise<void> {
  await relay.start();
}

export async function stopToolEventRelay(): Promise<void> {
  await relay.stop();
}
