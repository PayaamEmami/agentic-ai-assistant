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
  createOptimisticUserMessage,
  createStreamingAssistantMessage,
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

  // Clears the active run state. Called when the socket reports the turn is
  // settled (done / interrupted / error), since the HTTP request now returns
  // before generation completes.
  const settleActiveRun = useCallback(() => {
    activeRunIdRef.current = null;
    activeRunConversationIdRef.current = undefined;
    setIsSendingMessage(false);
    setIsInterruptingMessage(false);
  }, []);

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

        // Add a streaming placeholder keyed by the server-assigned message id so
        // socket deltas can be appended live. The turn stays "sending" until the
        // socket reports it settled.
        setMessages((previous) => {
          if (previous.some((message) => message.id === response.messageId)) {
            return previous;
          }
          return [...previous, createStreamingAssistantMessage(response.messageId)];
        });

        await Promise.all([loadConversations(), loadPendingApprovals()]);
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : 'Failed to send message';
        setError(message);
        setMessages((previous) => [...previous, createErrorAssistantMessage(message)]);
        void reportClientError({
          event: 'client.chat.send_failed',
          component: 'chat-context',
          message: 'Failed to send chat message',
          error: requestError,
          conversationId: currentConversationId,
        });
        settleActiveRun();
      }
    },
    [
      currentConversationId,
      loadConversations,
      loadPendingApprovals,
      setConversations,
      setCurrentConversationId,
      setError,
      setMessages,
      settleActiveRun,
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
    settleActiveRun,
  };
}
