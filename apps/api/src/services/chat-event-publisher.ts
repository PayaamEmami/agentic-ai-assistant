import type {
  ApprovalRequestedEvent,
  AssistantInterruptedEvent,
  AssistantTextDoneEvent,
} from '@aaa/shared';
import { broadcast } from '../ws/connections.js';

export class ChatEventPublisher {
  assistantTextDone(event: AssistantTextDoneEvent): void {
    broadcast(event.conversationId, event);
  }

  approvalRequested(event: ApprovalRequestedEvent): void {
    broadcast(event.conversationId, event);
  }

  assistantInterrupted(event: AssistantInterruptedEvent): void {
    broadcast(event.conversationId, event);
  }
}
