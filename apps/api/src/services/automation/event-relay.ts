import {
  AUTOMATION_EVENT_CHANNEL,
  type AutomationRunActivityEvent,
  type AutomationRunStatusEvent,
} from '@aaa/shared';
import { createPgNotifyRelay } from '../../lib/pg-notify-relay.js';
import { broadcast } from '../../ws/connections.js';

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

/**
 * Relays automation run activity from the worker to subscribed browsers.
 *
 * Runs are keyed by their hidden conversation, so this reuses the same
 * per-conversation subscription and authorization the chat stream uses.
 */
const relay = createPgNotifyRelay({
  channel: AUTOMATION_EVENT_CHANNEL,
  component: 'automation-event-relay',
  eventPrefix: 'automation.event_relay',
  label: 'automation event relay',
  onPayload: (payload) => {
    if (isAutomationStatusEvent(payload) || isAutomationActivityEvent(payload)) {
      broadcast(payload.conversationId, payload);
    }
  },
});

export async function startAutomationEventRelay(): Promise<void> {
  await relay.start();
}

export async function stopAutomationEventRelay(): Promise<void> {
  await relay.stop();
}
