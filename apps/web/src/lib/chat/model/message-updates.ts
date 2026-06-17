import { createOptimisticVoiceMessage } from './message-builders';
import type {
  AssistantStage,
  ChatMessage,
  MessageContentBlock,
  ThinkingContentBlock,
  ToolResultContentBlock,
} from './message-types';

function updateMessageById(
  messages: ChatMessage[],
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }
    changed = true;
    return update(message);
  });
  return changed ? next : messages;
}

export function appendAssistantTextDelta(
  messages: ChatMessage[],
  messageId: string,
  delta: string,
): ChatMessage[] {
  return updateMessageById(messages, messageId, (message) => {
    let appended = false;
    const content = message.content.map((block) => {
      if (!appended && block.type === 'text') {
        appended = true;
        return { ...block, text: block.text + delta };
      }
      return block;
    });

    const nextContent: MessageContentBlock[] = appended
      ? content
      : [{ type: 'text', text: delta }, ...message.content];

    return {
      ...message,
      content: nextContent,
      presentation: { ...message.presentation, streaming: true },
    };
  });
}

export function appendAssistantThinkingDelta(
  messages: ChatMessage[],
  messageId: string,
  stage: AssistantStage,
  delta: string,
): ChatMessage[] {
  return updateMessageById(messages, messageId, (message) => {
    const existing = message.content.find(
      (block): block is ThinkingContentBlock => block.type === 'thinking',
    );

    let thinkingBlock: ThinkingContentBlock;
    if (existing) {
      const segments = [...existing.segments];
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && lastSegment.stage === stage) {
        segments[segments.length - 1] = { ...lastSegment, text: lastSegment.text + delta };
      } else {
        segments.push({ stage, text: delta });
      }
      thinkingBlock = { type: 'thinking', segments };
    } else {
      thinkingBlock = { type: 'thinking', segments: [{ stage, text: delta }] };
    }

    const content = existing
      ? message.content.map((block) => (block.type === 'thinking' ? thinkingBlock : block))
      : insertThinkingBlock(message.content, thinkingBlock);

    return {
      ...message,
      content,
      presentation: { ...message.presentation, streaming: true },
    };
  });
}

function insertThinkingBlock(
  content: MessageContentBlock[],
  thinkingBlock: ThinkingContentBlock,
): MessageContentBlock[] {
  const firstTextIndex = content.findIndex((block) => block.type === 'text');
  if (firstTextIndex === -1) {
    return [thinkingBlock, ...content];
  }
  const next = [...content];
  next.splice(firstTextIndex + 1, 0, thinkingBlock);
  return next;
}

export function setAssistantStage(
  messages: ChatMessage[],
  messageId: string,
  stage: AssistantStage,
): ChatMessage[] {
  return updateMessageById(messages, messageId, (message) => ({
    ...message,
    presentation: {
      ...message.presentation,
      activeStage: stage,
      streaming: stage !== 'done' ? true : message.presentation?.streaming,
    },
  }));
}

export function patchMessagesToolResult(
  messages: ChatMessage[],
  toolExecutionId: string | undefined,
  patch: Partial<Pick<ToolResultContentBlock, 'status' | 'detail' | 'output'>>,
): ChatMessage[] {
  if (!toolExecutionId) {
    return messages;
  }

  let changed = false;
  const nextMessages = messages.map((message) => {
    let messageChanged = false;
    const nextContent = message.content.map((block) => {
      if (block.type !== 'tool_result' || block.toolExecutionId !== toolExecutionId) {
        return block;
      }

      messageChanged = true;
      const nextBlock: ToolResultContentBlock = { ...block };

      if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
        if (typeof patch.status === 'undefined') {
          delete nextBlock.status;
        } else {
          nextBlock.status = patch.status;
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'detail')) {
        if (typeof patch.detail === 'undefined') {
          delete nextBlock.detail;
        } else {
          nextBlock.detail = patch.detail;
        }
      }

      if (Object.prototype.hasOwnProperty.call(patch, 'output')) {
        if (typeof patch.output === 'undefined') {
          delete nextBlock.output;
        } else {
          nextBlock.output = patch.output;
        }
      }

      return nextBlock;
    });

    if (!messageChanged) {
      return message;
    }

    changed = true;
    return {
      ...message,
      content: nextContent,
    };
  });

  return changed ? nextMessages : messages;
}

export function upsertVoiceMessageInList(
  messages: ChatMessage[],
  messageId: string,
  role: 'user' | 'assistant',
  text: string,
): ChatMessage[] {
  const message = createOptimisticVoiceMessage(role, text, {
    id: messageId,
    animateText: role === 'assistant',
  });
  const textBlock = message.content[0];
  const existingIndex = messages.findIndex((item) => item.id === messageId);

  if (!textBlock) {
    return messages;
  }

  if (existingIndex === -1) {
    return [...messages, message];
  }

  return messages.map((item, index) =>
    index === existingIndex
      ? {
          ...item,
          role,
          content: item.content.some((block) => block.type === 'text')
            ? item.content.map((block) => (block.type === 'text' ? textBlock : block))
            : [textBlock, ...item.content],
          presentation: message.presentation,
        }
      : item,
  );
}
