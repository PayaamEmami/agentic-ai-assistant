import { createOptimisticVoiceMessage } from './message-builders';
import type { ChatMessage, ToolResultContentBlock } from './chat-message-types';

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
