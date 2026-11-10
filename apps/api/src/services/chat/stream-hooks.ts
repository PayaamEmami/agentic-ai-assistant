import type { AssistantStage } from '@aaa/shared';
import type { ChatEventPublisher } from './event-publisher.js';

export interface ThinkingSegment {
  stage: AssistantStage;
  text: string;
}

export interface AssistantStreamHooks {
  onStage?: (stage: AssistantStage) => void;
  onAnswerDelta?: (delta: string) => void;
}

export interface AssistantStreamHooksBundle {
  hooks: AssistantStreamHooks;
  collectThinkingSegments(): ThinkingSegment[];
}

/**
 * Wires a chat turn's streaming callbacks to WebSocket events. Stage changes
 * and answer tokens are published as they happen.
 */
export function createAssistantStreamHooks(
  eventPublisher: ChatEventPublisher,
  conversationId: string,
  assistantMessageId: string,
): AssistantStreamHooksBundle {
  const hooks: AssistantStreamHooks = {
    onStage: (stage) => {
      eventPublisher.assistantStatus({
        type: 'assistant.status',
        conversationId,
        messageId: assistantMessageId,
        stage,
      });
    },
    onAnswerDelta: (delta) => {
      if (!delta) {
        return;
      }
      eventPublisher.assistantTextDelta({
        type: 'assistant.text.delta',
        conversationId,
        messageId: assistantMessageId,
        delta,
      });
    },
  };

  return { hooks, collectThinkingSegments: () => [] };
}
