'use client';

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { api } from '../api-client';
import { reportClientError } from '../client-logging';
import { createClientId } from '../uuid';
import {
  buildConversationTitle,
  createErrorAssistantMessage,
  createFallbackAssistantMessage,
  createOptimisticUserMessage,
  normalizeMessage,
  upsertConversation,
  type ChatMessage,
  type ConversationSummary,
  type UploadedAttachment,
} from './model/index';

interface UseChatActionsOptions {
  currentConversationId?: string;
  messagesRef: MutableRefObject<ChatMessage[]>;
  setError: (message: string | null) => void;
  setConversations: Dispatch<SetStateAction<ConversationSummary[]>>;
  setCurrentConversationId: Dispatch<SetStateAction<string | undefined>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  loadConversations: () => Promise<void>;
  refreshConversation: (conversationId: string) => Promise<void>;
  loadPendingApprovals: () => Promise<void>;
}

export function useChatActions({
  currentConversationId,
  messagesRef,
  setError,
  setConversations,
  setCurrentConversationId,
  setMessages,
  loadConversations,
  refreshConversation,
  loadPendingApprovals,
}: UseChatActionsOptions) {
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isInterruptingMessage, setIsInterruptingMessage] = useState(false);
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunConversationIdRef = useRef<string | undefined>(undefined);

  const sendMessage = useCallback(
    async (content: string, attachments: UploadedAttachment[] = []) => {
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return;
      }

      setError(null);
      setIsSendingMessage(true);
      setIsInterruptingMessage(false);

      const clientRunId = createClientId();
      const existingMessageIds = new Set(messagesRef.current.map((message) => message.id));
      activeRunIdRef.current = clientRunId;
      activeRunConversationIdRef.current = currentConversationId;

      const optimisticUserMessage = createOptimisticUserMessage(trimmedContent, attachments);
      setMessages((previous) => [...previous, optimisticUserMessage]);

      try {
        const attachmentIds = attachments.map((attachment) => attachment.id);
        const response = await api.chat.send(
          trimmedContent,
          currentConversationId,
          attachmentIds.length > 0 ? attachmentIds : undefined,
          clientRunId,
        );

        const timestamp = new Date().toISOString();
        activeRunConversationIdRef.current = response.conversationId;
        setCurrentConversationId(response.conversationId);
        setConversations((previous) =>
          upsertConversation(previous, {
            id: response.conversationId,
            title: buildConversationTitle(trimmedContent),
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );

        let hasAssistantMessage = false;
        try {
          const detail = await api.chat.getConversation(response.conversationId);
          const nextMessages = detail.messages.map((message) => {
            const normalized = normalizeMessage(message);
            if (normalized.role === 'assistant' && !existingMessageIds.has(normalized.id)) {
              return {
                ...normalized,
                presentation: { animateText: true },
              };
            }
            return normalized;
          });
          if (nextMessages.length > 0) {
            hasAssistantMessage = nextMessages.some((message) => message.role !== 'user');
            setMessages(nextMessages);
          }
        } catch (detailError) {
          void reportClientError({
            event: 'client.chat.refresh_failed',
            component: 'chat-context',
            message: 'Failed to refresh conversation after send',
            error: detailError,
            conversationId: response.conversationId,
          });
        }

        if (!hasAssistantMessage) {
          setMessages((previous) => [
            ...previous,
            createFallbackAssistantMessage(response.messageId, { animateText: true }),
          ]);
        }

        await Promise.all([loadConversations(), loadPendingApprovals()]);
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : 'Failed to send message';
        setError(message);
        setMessages((previous) => [
          ...previous,
          createErrorAssistantMessage(message, { animateText: true }),
        ]);
      } finally {
        activeRunIdRef.current = null;
        activeRunConversationIdRef.current = undefined;
        setIsSendingMessage(false);
        setIsInterruptingMessage(false);
      }
    },
    [
      currentConversationId,
      loadConversations,
      loadPendingApprovals,
      messagesRef,
      setConversations,
      setCurrentConversationId,
      setError,
      setMessages,
    ],
  );

  const interruptMessage = useCallback(async () => {
    const activeRunId = activeRunIdRef.current;
    if (!activeRunId) {
      return;
    }

    setError(null);
    setIsInterruptingMessage(true);

    try {
      const response = await api.chat.interruptRun(activeRunId);
      const conversationId = response.conversationId ?? activeRunConversationIdRef.current;

      if (conversationId) {
        activeRunConversationIdRef.current = conversationId;
        setCurrentConversationId(conversationId);
        await Promise.all([refreshConversation(conversationId), loadConversations()]);
      }
    } catch (requestError) {
      setIsInterruptingMessage(false);
      setError(requestError instanceof Error ? requestError.message : 'Failed to stop message');
      throw requestError;
    }
  }, [loadConversations, refreshConversation, setCurrentConversationId, setError]);

  return {
    isSendingMessage,
    isInterruptingMessage,
    sendMessage,
    interruptMessage,
  };
}
