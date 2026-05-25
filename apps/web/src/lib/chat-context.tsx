'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuthContext } from './auth-context';
import { api } from './api-client';
import { reportClientError } from './client-logging';
import {
  buildConversationTitle,
  createErrorAssistantMessage,
  createFallbackAssistantMessage,
  createOptimisticUserMessage,
  extractCitations,
  mergeConversations,
  normalizeConversationSummary,
  normalizeMessage,
  parseApprovalStatus,
  patchMessagesToolResult,
  upsertVoiceMessageInList,
  upsertConversation,
  type ChatMessage,
  type CitationItem,
  type ConversationSummary,
  type UploadedAttachment,
} from './chat-message-model';
import {
  useToolEventBus,
  type ToolEventListener,
} from './chat-tool-events';
import { useChatWebSocket } from './use-chat-websocket';
import { createClientId } from './uuid';

export type {
  ChatMessage,
  ChatRole,
  CitationContentBlock,
  CitationItem,
  ConversationSummary,
  MessageContentBlock,
  StatusContentBlock,
  TextContentBlock,
  ToolResultContentBlock,
  TranscriptContentBlock,
  UploadedAttachment,
} from './chat-message-model';

export interface PendingApproval {
  id: string;
  toolExecutionId: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
}

export interface ApprovalStatusByToolExecution {
  [toolExecutionId: string]: 'pending' | 'approved' | 'rejected' | 'expired';
}

export interface ChatLoadingState {
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  isSendingMessage: boolean;
  isInterruptingMessage: boolean;
  isUploadingAttachment: boolean;
  isLoadingApprovals: boolean;
}

export type { ToolEventListener, ToolEventPayload } from './chat-tool-events';

interface ChatContextValue {
  conversations: ConversationSummary[];
  currentConversationId?: string;
  messages: ChatMessage[];
  pendingApprovals: PendingApproval[];
  approvalStatusesByToolExecution: ApprovalStatusByToolExecution;
  citations: CitationItem[];
  loading: ChatLoadingState;
  error: string | null;
  sendMessage: (content: string, attachments?: UploadedAttachment[]) => Promise<void>;
  interruptMessage: () => Promise<void>;
  loadConversations: () => Promise<void>;
  selectConversation: (conversationId?: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  uploadAttachment: (
    file: File,
    options?: { indexForRag?: boolean },
  ) => Promise<UploadedAttachment>;
  approveAction: (approvalId: string) => Promise<void>;
  rejectAction: (approvalId: string) => Promise<void>;
  startLiveVoiceSession: () => Promise<{
    sessionId: string;
    clientSecret: string;
    expiresAt: string;
    conversationId: string;
    model: string;
    voice: string;
  }>;
  upsertVoiceMessage: (
    conversationId: string,
    messageId: string,
    role: 'user' | 'assistant',
    text: string,
  ) => void;
  syncConversationState: (conversationId: string) => Promise<void>;
  subscribeToolEvents: (listener: ToolEventListener) => () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuthContext();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvalStatusesByToolExecution, setApprovalStatusesByToolExecution] =
    useState<ApprovalStatusByToolExecution>({});

  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isInterruptingMessage, setIsInterruptingMessage] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunConversationIdRef = useRef<string | undefined>(undefined);
  const messagesRef = useRef<ChatMessage[]>([]);
  const toolEvents = useToolEventBus();

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const loadPendingApprovals = useCallback(async () => {
    setIsLoadingApprovals(true);
    try {
      const response = await api.approvals.listPending();
      const approvals = response.approvals
        .map((item) => ({
          id: item.id,
          toolExecutionId: item.toolExecutionId,
          description: item.description,
          status: parseApprovalStatus(item.status),
          createdAt: item.createdAt ?? new Date().toISOString(),
        }))
        .filter((item) => item.status === 'pending');
      setPendingApprovals(approvals);
      setApprovalStatusesByToolExecution((previous) => {
        const next = { ...previous };

        for (const [toolExecutionId, status] of Object.entries(next)) {
          if (status === 'pending') {
            delete next[toolExecutionId];
          }
        }

        for (const approval of approvals) {
          next[approval.toolExecutionId] = approval.status;
        }

        return next;
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load approvals');
    } finally {
      setIsLoadingApprovals(false);
    }
  }, []);

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
  }, []);

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
    [refreshConversation],
  );

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
    [currentConversationId, loadConversations, loadPendingApprovals],
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
  }, [loadConversations, refreshConversation]);

  const uploadAttachment = useCallback(async (file: File, options?: { indexForRag?: boolean }) => {
    setError(null);
    setIsUploadingAttachment(true);
    try {
      const response = await api.upload.uploadFile(file, options);
      return {
        id: response.attachmentId,
        name: response.fileName,
        mimeType: response.mimeType,
        kind: response.kind,
        indexedForRag: response.indexedForRag,
        documentId: response.documentId,
      };
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Failed to upload attachment',
      );
      throw requestError;
    } finally {
      setIsUploadingAttachment(false);
    }
  }, []);

  const decideApproval = useCallback(
    async (approvalId: string, status: 'approved' | 'rejected') => {
      setError(null);
      try {
        const matchingApproval = pendingApprovals.find((item) => item.id === approvalId);
        await api.approvals.decide(approvalId, status);
        setPendingApprovals((previous) => previous.filter((item) => item.id !== approvalId));
        if (matchingApproval) {
          setApprovalStatusesByToolExecution((previous) => ({
            ...previous,
            [matchingApproval.toolExecutionId]: status,
          }));
        }
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to decide approval',
        );
        throw requestError;
      }
    },
    [pendingApprovals],
  );

  const approveAction = useCallback(
    async (approvalId: string) => {
      await decideApproval(approvalId, 'approved');
    },
    [decideApproval],
  );

  const rejectAction = useCallback(
    async (approvalId: string) => {
      await decideApproval(approvalId, 'rejected');
    },
    [decideApproval],
  );

  const startLiveVoiceSession = useCallback(async () => {
    setError(null);
    const session = await api.voice.createSession(currentConversationId);
    await syncConversationState(session.conversationId);
    return session;
  }, [currentConversationId, syncConversationState]);

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

  const renameConversation = useCallback(async (conversationId: string, title: string) => {
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
  }, []);

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

        await loadPendingApprovals();
      } catch (requestError) {
        setError(
          requestError instanceof Error ? requestError.message : 'Failed to delete conversation',
        );
        throw requestError;
      }
    },
    [conversations, currentConversationId, loadPendingApprovals, refreshConversation],
  );

  const patchToolResult = useCallback(
    (
      toolExecutionId: string | undefined,
      patch: Parameters<typeof patchMessagesToolResult>[2],
    ) => {
      setMessages((previous) => patchMessagesToolResult(previous, toolExecutionId, patch));
    },
    [],
  );

  const resolveApprovalFromSocket = useCallback(
    (toolExecutionId: string | undefined, status: 'approved' | 'rejected' | undefined) => {
      if (!toolExecutionId || !status) {
        return;
      }

      setApprovalStatusesByToolExecution((previous) => ({
        ...previous,
        [toolExecutionId]: status,
      }));
      patchToolResult(toolExecutionId, {
        status,
        detail: undefined,
        output: undefined,
      });
    },
    [patchToolResult],
  );

  const reportRealtimeError = useCallback((message: string) => {
    setError(message);
  }, []);

  useEffect(() => {
    void loadConversations();
    void loadPendingApprovals();
  }, [loadConversations, loadPendingApprovals]);

  useChatWebSocket({
    token,
    conversationId: currentConversationId,
    refreshConversation,
    loadPendingApprovals,
    patchToolResult,
    resolveApproval: resolveApprovalFromSocket,
    emitToolEvent: toolEvents.emit,
    reportRealtimeError,
  });

  const citations = useMemo<CitationItem[]>(() => extractCitations(messages), [messages]);

  const loading = useMemo<ChatLoadingState>(
    () => ({
      isLoadingConversations,
      isLoadingMessages,
      isSendingMessage,
      isInterruptingMessage,
      isUploadingAttachment,
      isLoadingApprovals,
    }),
    [
      isLoadingApprovals,
      isLoadingConversations,
      isLoadingMessages,
      isSendingMessage,
      isInterruptingMessage,
      isUploadingAttachment,
    ],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      currentConversationId,
      messages,
      pendingApprovals,
      approvalStatusesByToolExecution,
      citations,
      loading,
      error,
      sendMessage,
      interruptMessage,
      loadConversations,
      selectConversation,
      renameConversation,
      deleteConversation,
      uploadAttachment,
      approveAction,
      rejectAction,
      startLiveVoiceSession,
      upsertVoiceMessage,
      syncConversationState,
      subscribeToolEvents: toolEvents.subscribe,
    }),
    [
      approveAction,
      approvalStatusesByToolExecution,
      citations,
      conversations,
      currentConversationId,
      error,
      interruptMessage,
      loadConversations,
      loading,
      messages,
      pendingApprovals,
      deleteConversation,
      rejectAction,
      renameConversation,
      selectConversation,
      sendMessage,
      startLiveVoiceSession,
      upsertVoiceMessage,
      syncConversationState,
      toolEvents,
      uploadAttachment,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within ChatProvider');
  }
  return context;
}
