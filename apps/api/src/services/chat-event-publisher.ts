import type {
  ApprovalRequestedEvent,
  AssistantInterruptedEvent,
  AssistantStatusEvent,
  AssistantTextDoneEvent,
  AssistantTextEvent,
  AssistantThinkingDeltaEvent,
  ErrorEvent,
} from '@aaa/shared';
import { broadcast } from '../ws/connections.js';

export class ChatEventPublisher {
  assistantTextDelta(event: AssistantTextEvent): void {
    broadcast(event.conversationId, event);
  }

  assistantStatus(event: AssistantStatusEvent): void {
    broadcast(event.conversationId, event);
  }

  assistantThinkingDelta(event: AssistantThinkingDeltaEvent): void {
    broadcast(event.conversationId, event);
  }

  assistantTextDone(event: AssistantTextDoneEvent): void {
    broadcast(event.conversationId, event);
  }

  error(event: ErrorEvent): void {
    broadcast(event.conversationId, event);
  }

  approvalRequested(event: ApprovalRequestedEvent): void {
    broadcast(event.conversationId, event);
  }

  assistantInterrupted(event: AssistantInterruptedEvent): void {
    broadcast(event.conversationId, event);
  }
}
