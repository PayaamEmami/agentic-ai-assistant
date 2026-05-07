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
import { api, buildWebSocketUrl } from './api-client';
import { reportClientError } from './client-logging';
import {
  buildConversationTitle,
  createFallbackAssistantMessage,
  createOptimisticUserMessage,
  createOptimisticVoiceMessage,
  extractCitations,
  mergeConversations,
  normalizeConversationSummary,
  normalizeMessage,
  parseApprovalStatus,
  patchMessagesToolResult,
  upsertConversation,
  type ChatMessage,
  type CitationItem,
  type ConversationSummary,
  type UploadedAttachment,
} from './chat-message-model';
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

export interface ToolEventPayload {
  type: 'tool.done' | 'approval.resolved';
  conversationId?: string;
  toolExecutionId?: string;
  output?: unknown;
  status?: string;
}

export type ToolEventListener = (event: ToolEventPayload) => void;

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
    options?: { voiceStreaming?: boolean },
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
  const [citations, setCitations] = useState<CitationItem[]>([]);

  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isInterruptingMessage, setIsInterruptingMessage] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunConversationIdRef = useRef<string | undefined>(undefined);
  const toolEventListenersRef = useRef<Set<ToolEventListener>>(new Set());

  const subscribeToolEvents = useCallback((listener: ToolEventListener) => {
    toolEventListenersRef.current.add(listener);
    return () => {
      toolEventListenersRef.current.delete(listener);
    };
  }, []);

  const emitToolEvent = useCallback((payload: ToolEventPayload) => {
    for (const listener of toolEventListenersRef.current) {
      try {
        listener(payload);
      } catch (listenerError) {
        void reportClientError({
          event: 'client.chat.tool_listener_failed',
          component: 'chat-context',
          message: 'Tool event listener threw an error',
          error: listenerError,
        });
      }
    }
  }, []);

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
          const nextMessages = detail.messages.map(normalizeMessage);
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
            createFallbackAssistantMessage(response.messageId),
          ]);
        }

        await Promise.all([loadConversations(), loadPendingApprovals()]);
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : 'Failed to send message';
        setError(message);
        setMessages((previous) => [
          ...previous,
          {
            id: `local-error-${createClientId()}`,
            role: 'assistant',
            content: [{ type: 'text', text: `Error: ${message}` }],
            createdAt: new Date().toISOString(),
          },
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
      options: { voiceStreaming?: boolean } = {},
    ) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      setCurrentConversationId(conversationId);
      setMessages((previous) => {
        const message = createOptimisticVoiceMessage(role, trimmed, {
          id: messageId,
          voiceStreaming: options.voiceStreaming,
        });
        const textBlock = message.content[0];
        const existingIndex = previous.findIndex((item) => item.id === messageId);

        if (!textBlock) {
          return previous;
        }

        if (existingIndex === -1) {
          return [...previous, message];
        }

        return previous.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                role,
                content: item.content.some((block) => block.type === 'text')
                  ? item.content.map((block) =>
                      block.type === 'text' ? textBlock : block,
                    )
                  : [textBlock, ...item.content],
                presentation: message.presentation,
              }
            : item,
        );
      });
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

  useEffect(() => {
    void loadConversations();
    void loadPendingApprovals();
  }, [loadConversations, loadPendingApprovals]);

  useEffect(() => {
    if (!token || !currentConversationId) {
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    const socket = new WebSocket(buildWebSocketUrl(token));
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          conversationId: currentConversationId,
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      let parsed: { type?: string; conversationId?: string };
      try {
        parsed = JSON.parse(event.data as string) as { type?: string; conversationId?: string };
      } catch {
        return;
      }

      switch (parsed.type) {
        case 'assistant.text.done':
        case 'assistant.interrupted':
          void refreshConversation(currentConversationId);
          return;
        case 'tool.start':
          setMessages((previous) =>
            patchMessagesToolResult(
              previous,
              (parsed as { toolExecutionId?: string }).toolExecutionId,
              {
                status: 'running',
                detail: undefined,
                output: undefined,
              },
            ),
          );
          return;
        case 'tool.progress': {
          const progress = parsed as {
            toolExecutionId?: string;
            message?: string;
          };
          setMessages((previous) =>
            patchMessagesToolResult(previous, progress.toolExecutionId, {
              status: 'running',
              detail: progress.message,
            }),
          );
          return;
        }
        case 'tool.done': {
          const done = parsed as {
            toolExecutionId?: string;
            output?: unknown;
            status?: 'completed' | 'failed';
            conversationId?: string;
          };
          setMessages((previous) =>
            patchMessagesToolResult(previous, done.toolExecutionId, {
              status: done.status,
              output: done.output,
              detail: undefined,
            }),
          );
          emitToolEvent({
            type: 'tool.done',
            conversationId: done.conversationId,
            toolExecutionId: done.toolExecutionId,
            output: done.output,
            status: done.status,
          });
          return;
        }
        case 'approval.requested':
          void loadPendingApprovals();
          void refreshConversation(currentConversationId);
          return;
        case 'approval.resolved': {
          const resolved = parsed as {
            toolExecutionId?: string;
            status?: 'approved' | 'rejected';
            conversationId?: string;
          };
          if (
            resolved.toolExecutionId &&
            (resolved.status === 'approved' || resolved.status === 'rejected')
          ) {
            setApprovalStatusesByToolExecution((previous) => ({
              ...previous,
              [resolved.toolExecutionId as string]: resolved.status as 'approved' | 'rejected',
            }));
            setMessages((previous) =>
              patchMessagesToolResult(previous, resolved.toolExecutionId, {
                status: resolved.status,
                detail: undefined,
                output: undefined,
              }),
            );
          }
          emitToolEvent({
            type: 'approval.resolved',
            conversationId: resolved.conversationId,
            toolExecutionId: resolved.toolExecutionId,
            status: resolved.status,
          });
          void loadPendingApprovals();
          return;
        }
        case 'error':
          setError('Realtime connection was rejected.');
          return;
        default:
          return;
      }
    });

    socket.addEventListener('close', () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    });

    return () => {
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [currentConversationId, emitToolEvent, loadPendingApprovals, refreshConversation, token]);

  useEffect(() => {
    setCitations(extractCitations(messages));
  }, [messages]);

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
      subscribeToolEvents,
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
      subscribeToolEvents,
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
