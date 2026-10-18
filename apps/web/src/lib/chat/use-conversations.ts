'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import {
  DEFAULT_NEW_CHAT_MODEL,
  LEGACY_CHAT_MODEL,
  type ChatModelId,
} from '@aaa/shared';
import { api } from '../api-client';
import { isCurrentConversationLoad } from './conversation-load';
import {
  buildConversationTitle,
  hasSettledAssistantContent,
  keepLocalChatModels,
  mergeConversations,
  mergeRemoteConversationMessages,
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
  const [currentConversationId, setCurrentConversationIdState] = useState<string | undefined>(
    undefined,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftChatModel, setDraftChatModel] = useState<ChatModelId>(DEFAULT_NEW_CHAT_MODEL);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const currentConversationIdRef = useRef<string | undefined>(undefined);
  const loadGenerationRef = useRef(0);
  const chatModelPatchRef = useRef<AbortController | null>(null);
  const savedChatModelRef = useRef(new Map<string, ChatModelId>());
  const chatModelEpochRef = useRef(0);
  const conversationListRequestRef = useRef(0);

  const setCurrentConversationId = useCallback(
    (conversationId: SetStateAction<string | undefined>) => {
      if (typeof conversationId === 'function') {
        setCurrentConversationIdState((previous) => {
          const next = conversationId(previous);
          currentConversationIdRef.current = next;
          return next;
        });
        return;
      }

      currentConversationIdRef.current = conversationId;
      setCurrentConversationIdState(conversationId);
    },
    [],
  );

  const beginConversationLoad = useCallback((conversationId: string | undefined) => {
    loadGenerationRef.current += 1;
    currentConversationIdRef.current = conversationId;
    setCurrentConversationIdState(conversationId);
    return loadGenerationRef.current;
  }, []);

  useEffect(() => {
    for (const conversation of conversations) {
      if (!savedChatModelRef.current.has(conversation.id)) {
        savedChatModelRef.current.set(conversation.id, conversation.chatModel);
      }
    }
  }, [conversations]);

  const loadConversations = useCallback(async () => {
    const epochAtStart = chatModelEpochRef.current;
    const requestId = ++conversationListRequestRef.current;
    setIsLoadingConversations(true);
    try {
      const response = await api.chat.listConversations();
      if (requestId !== conversationListRequestRef.current) {
        return;
      }
      const remoteConversations = response.conversations.map(normalizeConversationSummary);
      const preserveLocalModels = chatModelEpochRef.current !== epochAtStart;
      setConversations((previous) => {
        const merged = mergeConversations(previous, remoteConversations);
        const next = preserveLocalModels ? keepLocalChatModels(previous, merged) : merged;
        for (const conversation of next) {
          savedChatModelRef.current.set(conversation.id, conversation.chatModel);
        }
        return next;
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Failed to load conversations',
      );
    } finally {
      if (requestId === conversationListRequestRef.current) {
        setIsLoadingConversations(false);
      }
    }
  }, [setError]);

  const loadConversationMessages = useCallback(async (conversationId: string) => {
    const response = await api.chat.getConversation(conversationId);
    return response.messages.map(normalizeMessage);
  }, []);

  const refreshConversation = useCallback(
    async (conversationId: string, loadGeneration = loadGenerationRef.current) => {
      const epochAtStart = chatModelEpochRef.current;
      const response = await api.chat.getConversation(conversationId);
      if (
        !isCurrentConversationLoad({
          requestedId: conversationId,
          currentId: currentConversationIdRef.current,
          loadGeneration,
          currentGeneration: loadGenerationRef.current,
        })
      ) {
        return;
      }
      const preserveLocalModel = chatModelEpochRef.current !== epochAtStart;
      if (!preserveLocalModel) {
        savedChatModelRef.current.set(conversationId, response.chatModel);
      }
      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === conversationId && !preserveLocalModel
            ? { ...conversation, chatModel: response.chatModel }
            : conversation,
        ),
      );
      setMessages(response.messages.map(normalizeMessage));
    },
    [],
  );

  const syncConversationMessages = useCallback(
    async (conversationId: string) => {
      const loadGeneration = loadGenerationRef.current;
      try {
        const remote = await loadConversationMessages(conversationId);
        if (
          !isCurrentConversationLoad({
            requestedId: conversationId,
            currentId: currentConversationIdRef.current,
            loadGeneration,
            currentGeneration: loadGenerationRef.current,
          })
        ) {
          return;
        }
        setMessages((previous) => mergeRemoteConversationMessages(previous, remote));
      } catch {
        // Live recovery should not clear the in-progress transcript.
      }
    },
    [loadConversationMessages],
  );

  const pullSettledAssistantTurn = useCallback(
    async (conversationId: string, assistantMessageId: string) => {
      const loadGeneration = loadGenerationRef.current;
      try {
        const remote = await loadConversationMessages(conversationId);
        if (
          !isCurrentConversationLoad({
            requestedId: conversationId,
            currentId: currentConversationIdRef.current,
            loadGeneration,
            currentGeneration: loadGenerationRef.current,
          })
        ) {
          return false;
        }
        const remoteAssistant = remote.find((message) => message.id === assistantMessageId);
        if (!remoteAssistant || !hasSettledAssistantContent(remoteAssistant)) {
          return false;
        }

        setMessages((previous) => mergeRemoteConversationMessages(previous, remote));
        return true;
      } catch {
        return false;
      }
    },
    [loadConversationMessages],
  );

  const syncConversationState = useCallback(
    async (conversationId: string) => {
      const loadGeneration = beginConversationLoad(conversationId);
      await refreshConversation(conversationId, loadGeneration);
      await loadConversations();
    },
    [beginConversationLoad, loadConversations, refreshConversation],
  );

  const selectConversation = useCallback(
    async (conversationId?: string) => {
      setError(null);
      const loadGeneration = beginConversationLoad(conversationId);

      if (!conversationId) {
        setDraftChatModel(DEFAULT_NEW_CHAT_MODEL);
        setMessages([]);
        return;
      }

      setIsLoadingMessages(true);
      try {
        await refreshConversation(conversationId, loadGeneration);
      } catch (requestError) {
        if (loadGeneration !== loadGenerationRef.current) {
          return;
        }
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to load conversation',
        );
        setMessages([]);
      } finally {
        if (loadGeneration === loadGenerationRef.current) {
          setIsLoadingMessages(false);
        }
      }
    },
    [beginConversationLoad, refreshConversation, setError],
  );

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      setError(null);
      try {
        const response = await api.chat.updateConversation(conversationId, { title });
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
          const loadGeneration = beginConversationLoad(nextConversationId);

          if (!nextConversationId) {
            setMessages([]);
          } else {
            setIsLoadingMessages(true);
            try {
              await refreshConversation(nextConversationId, loadGeneration);
            } catch (requestError) {
              if (loadGeneration === loadGenerationRef.current) {
                setError(
                  requestError instanceof Error
                    ? requestError.message
                    : 'Failed to load conversation',
                );
                setMessages([]);
              }
            } finally {
              if (loadGeneration === loadGenerationRef.current) {
                setIsLoadingMessages(false);
              }
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
      beginConversationLoad,
      conversations,
      currentConversationId,
      onDeleteConversation,
      refreshConversation,
      setError,
    ],
  );

  const setChatModel = useCallback(
    async (model: ChatModelId) => {
      setError(null);
      const conversationId = currentConversationIdRef.current;
      if (!conversationId) {
        setDraftChatModel(model);
        return;
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, chatModel: model } : conversation,
        ),
      );

      chatModelPatchRef.current?.abort();
      const controller = new AbortController();
      chatModelPatchRef.current = controller;

      try {
        const response = await api.chat.updateConversation(
          conversationId,
          { chatModel: model },
          controller.signal,
        );
        if (controller.signal.aborted || chatModelPatchRef.current !== controller) {
          return;
        }
        const saved = normalizeConversationSummary(response.conversation);
        savedChatModelRef.current.set(conversationId, saved.chatModel);
        chatModelEpochRef.current += 1;
        setConversations((current) => upsertConversation(current, saved));
      } catch (requestError) {
        if (controller.signal.aborted || chatModelPatchRef.current !== controller) {
          return;
        }
        const revertTo = savedChatModelRef.current.get(conversationId);
        if (revertTo) {
          setConversations((current) =>
            current.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, chatModel: revertTo }
                : conversation,
            ),
          );
        }
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to change chat model',
        );
      }
    },
    [setError],
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

      if (currentConversationIdRef.current !== conversationId) {
        beginConversationLoad(conversationId);
      } else {
        setCurrentConversationId(conversationId);
      }
      setMessages((previous) => upsertVoiceMessageInList(previous, messageId, role, trimmed));
      setConversations((previous) => {
        const existing = previous.find((conversation) => conversation.id === conversationId);
        const timestamp = new Date().toISOString();

        return upsertConversation(previous, {
          id: conversationId,
          title:
            existing?.title ??
            (role === 'user' ? buildConversationTitle(trimmed) : 'Untitled conversation'),
          chatModel: existing?.chatModel ?? LEGACY_CHAT_MODEL,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
      });
    },
    [beginConversationLoad, setCurrentConversationId],
  );

  const storedChatModel = conversations.find(
    (conversation) => conversation.id === currentConversationId,
  )?.chatModel;
  const chatModel = currentConversationId
    ? (storedChatModel ?? LEGACY_CHAT_MODEL)
    : draftChatModel;

  return {
    conversations,
    currentConversationId,
    messages,
    chatModel,
    isLoadingConversations,
    isLoadingMessages,
    loadConversations,
    refreshConversation,
    syncConversationMessages,
    pullSettledAssistantTurn,
    syncConversationState,
    selectConversation,
    renameConversation,
    deleteConversation,
    setChatModel,
    upsertVoiceMessage,
    setConversations,
    setCurrentConversationId,
    setMessages,
  };
}
