'use client';

import { useCallback, useState } from 'react';
import { api } from '../api-client';
import {
  buildConversationTitle,
  mergeConversations,
  normalizeConversationSummary,
  normalizeMessage,
  upsertConversation,
  upsertVoiceMessageInList,
  type ChatMessage,
  type ConversationSummary,
} from './model/index';

interface UseChatConversationsOptions {
  setError: (message: string | null) => void;
  onDeleteConversation?: () => void | Promise<void>;
}

export function useChatConversations({
  setError,
  onDeleteConversation,
}: UseChatConversationsOptions) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const loadConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const response = await api.chat.listConversations();
      const remoteConversations = response.conversations.map(normalizeConversationSummary);
      setConversations((previous) => mergeConversations(previous, remoteConversations));
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Failed to load conversations',
      );
    } finally {
      setIsLoadingConversations(false);
    }
  }, [setError]);

  const refreshConversation = useCallback(async (conversationId: string) => {
    const response = await api.chat.getConversation(conversationId);
    setMessages(response.messages.map(normalizeMessage));
  }, []);

  const syncConversationState = useCallback(
    async (conversationId: string) => {
      setCurrentConversationId(conversationId);
      await refreshConversation(conversationId);
      await loadConversations();
    },
    [loadConversations, refreshConversation],
  );

  const selectConversation = useCallback(
    async (conversationId?: string) => {
      setError(null);
      setCurrentConversationId(conversationId);

      if (!conversationId) {
        setMessages([]);
        return;
      }

      setIsLoadingMessages(true);
      try {
        await refreshConversation(conversationId);
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to load conversation',
        );
        setMessages([]);
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [refreshConversation, setError],
  );

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      setError(null);
      try {
        const response = await api.chat.updateConversation(conversationId, title);
        setConversations((previous) =>
          upsertConversation(previous, normalizeConversationSummary(response.conversation)),
        );
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to rename conversation',
        );
        throw requestError;
      }
    },
    [setError],
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      setError(null);
      try {
        await api.chat.deleteConversation(conversationId);
        const remaining = conversations.filter(
          (conversation) => conversation.id !== conversationId,
        );
        setConversations(remaining);

        if (currentConversationId === conversationId) {
          const nextConversationId = remaining[0]?.id;
          setCurrentConversationId(nextConversationId);

          if (!nextConversationId) {
            setMessages([]);
          } else {
            setIsLoadingMessages(true);
            try {
              await refreshConversation(nextConversationId);
            } catch (requestError) {
              setError(
                requestError instanceof Error
                  ? requestError.message
                  : 'Failed to load conversation',
              );
              setMessages([]);
            } finally {
              setIsLoadingMessages(false);
            }
          }
        }

        await onDeleteConversation?.();
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to delete conversation',
        );
        throw requestError;
      }
    },
    [
      conversations,
      currentConversationId,
      onDeleteConversation,
      refreshConversation,
      setError,
    ],
  );

  const upsertVoiceMessage = useCallback(
    (
      conversationId: string,
      messageId: string,
      role: 'user' | 'assistant',
      text: string,
    ) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      setCurrentConversationId(conversationId);
      setMessages((previous) => upsertVoiceMessageInList(previous, messageId, role, trimmed));
      setConversations((previous) => {
        const existing = previous.find((conversation) => conversation.id === conversationId);
        const timestamp = new Date().toISOString();

        return upsertConversation(previous, {
          id: conversationId,
          title:
            existing?.title ??
            (role === 'user' ? buildConversationTitle(trimmed) : 'Untitled conversation'),
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
      });
    },
    [],
  );

  return {
    conversations,
    currentConversationId,
    messages,
    isLoadingConversations,
    isLoadingMessages,
    loadConversations,
    refreshConversation,
    syncConversationState,
    selectConversation,
    renameConversation,
    deleteConversation,
    upsertVoiceMessage,
    setConversations,
    setCurrentConversationId,
    setMessages,
  };
}
