import type { AgentStreamHooks } from '@aaa/ai';
import type { AssistantStage } from '@aaa/shared';
import type { ChatEventPublisher } from './event-publisher.js';

export interface ThinkingSegment {
  stage: AssistantStage;
  text: string;
}

export interface AssistantStreamHooksBundle {
  hooks: AgentStreamHooks;
  collectThinkingSegments(): ThinkingSegment[];
}

/**
 * Wires the agent orchestrator's streaming callbacks to WebSocket events and
 * accumulates per-stage reasoning so the "thinking" trace can be persisted on
 * the message once streaming completes.
 */
export function createAssistantStreamHooks(
  eventPublisher: ChatEventPublisher,
  conversationId: string,
  assistantMessageId: string,
): AssistantStreamHooksBundle {
  const thinkingByStage = new Map<AssistantStage, string>();
  const thinkingStageOrder: AssistantStage[] = [];

  const hooks: AgentStreamHooks = {
    onStage: (stage) => {
      eventPublisher.assistantStatus({
        type: 'assistant.status',
        conversationId,
        messageId: assistantMessageId,
        stage,
      });
    },
    onReasoningDelta: (stage, delta) => {
      if (!delta) {
        return;
      }
      if (!thinkingByStage.has(stage)) {
        thinkingByStage.set(stage, '');
        thinkingStageOrder.push(stage);
      }
      thinkingByStage.set(stage, (thinkingByStage.get(stage) ?? '') + delta);
      eventPublisher.assistantThinkingDelta({
        type: 'assistant.thinking.delta',
        conversationId,
        messageId: assistantMessageId,
        stage,
        delta,
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

  const collectThinkingSegments = (): ThinkingSegment[] =>
    thinkingStageOrder
      .map((stage) => ({ stage, text: (thinkingByStage.get(stage) ?? '').trim() }))
      .filter((segment) => segment.text.length > 0);

  return { hooks, collectThinkingSegments };
}
