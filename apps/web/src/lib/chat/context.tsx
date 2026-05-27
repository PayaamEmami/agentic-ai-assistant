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
import { api } from '../api-client';
import { useAuthContext } from '../auth-context';
import {
  extractCitations,
  patchMessagesToolResult,
  type ChatMessage,
  type CitationItem,
} from './model/index';
import { useToolEventBus } from '../tool-events';
import { useChatWebSocket } from './use-websocket';
import { useChatActions } from './use-actions';
import { useChatApprovals } from './use-approvals';
import { useChatAttachments } from './use-attachments';
import { useChatConversations } from './use-conversations';
import type { ChatContextValue, ChatLoadingState } from './types';

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
} from './model/index';
export type {
  ApprovalStatusByToolExecution,
  ChatContextValue,
  ChatLoadingState,
  PendingApproval,
} from './types';
export type { ToolEventListener, ToolEventPayload } from '../tool-events';

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuthContext();
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const toolEvents = useToolEventBus();

  const approvals = useChatApprovals({ setError });
  const conversationsState = useChatConversations({
    setError,
    onDeleteConversation: approvals.loadPendingApprovals,
  });
  const attachments = useChatAttachments({ setError });
  const actions = useChatActions({
    currentConversationId: conversationsState.currentConversationId,
    messagesRef,
    setError,
    setConversations: conversationsState.setConversations,
    setCurrentConversationId: conversationsState.setCurrentConversationId,
    setMessages: conversationsState.setMessages,
    loadConversations: conversationsState.loadConversations,
    refreshConversation: conversationsState.refreshConversation,
    loadPendingApprovals: approvals.loadPendingApprovals,
  });

  useEffect(() => {
    messagesRef.current = conversationsState.messages;
  }, [conversationsState.messages]);

  const startLiveVoiceSession = useCallback(async () => {
    setError(null);
    const session = await api.voice.createSession(conversationsState.currentConversationId);
    await conversationsState.syncConversationState(session.conversationId);
    return session;
  }, [conversationsState.currentConversationId, conversationsState.syncConversationState]);

  const patchToolResult = useCallback(
    (
      toolExecutionId: string | undefined,
      patch: Parameters<typeof patchMessagesToolResult>[2],
    ) => {
      conversationsState.setMessages((previous) =>
        patchMessagesToolResult(previous, toolExecutionId, patch),
      );
    },
    [conversationsState.setMessages],
  );

  const resolveApprovalFromSocket = useCallback(
    (toolExecutionId: string | undefined, status: 'approved' | 'rejected' | undefined) => {
      approvals.resolveApprovalStatus(toolExecutionId, status);
      if (!toolExecutionId || !status) {
        return;
      }
      patchToolResult(toolExecutionId, {
        status,
        detail: undefined,
        output: undefined,
      });
    },
    [approvals.resolveApprovalStatus, patchToolResult],
  );

  const reportRealtimeError = useCallback((message: string) => {
    setError(message);
  }, []);

  useEffect(() => {
    void conversationsState.loadConversations();
    void approvals.loadPendingApprovals();
  }, [approvals.loadPendingApprovals, conversationsState.loadConversations]);

  useChatWebSocket({
    token,
    conversationId: conversationsState.currentConversationId,
    refreshConversation: conversationsState.refreshConversation,
    loadPendingApprovals: approvals.loadPendingApprovals,
    patchToolResult,
    resolveApproval: resolveApprovalFromSocket,
    emitToolEvent: toolEvents.emit,
    reportRealtimeError,
  });

  const citations = useMemo<CitationItem[]>(
    () => extractCitations(conversationsState.messages),
    [conversationsState.messages],
  );

  const loading = useMemo<ChatLoadingState>(
    () => ({
      isLoadingConversations: conversationsState.isLoadingConversations,
      isLoadingMessages: conversationsState.isLoadingMessages,
      isSendingMessage: actions.isSendingMessage,
      isInterruptingMessage: actions.isInterruptingMessage,
      isUploadingAttachment: attachments.isUploadingAttachment,
      isLoadingApprovals: approvals.isLoadingApprovals,
    }),
    [
      actions.isInterruptingMessage,
      actions.isSendingMessage,
      approvals.isLoadingApprovals,
      attachments.isUploadingAttachment,
      conversationsState.isLoadingConversations,
      conversationsState.isLoadingMessages,
    ],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations: conversationsState.conversations,
      currentConversationId: conversationsState.currentConversationId,
      messages: conversationsState.messages,
      pendingApprovals: approvals.pendingApprovals,
      approvalStatusesByToolExecution: approvals.approvalStatusesByToolExecution,
      citations,
      loading,
      error,
      sendMessage: actions.sendMessage,
      interruptMessage: actions.interruptMessage,
      loadConversations: conversationsState.loadConversations,
      selectConversation: conversationsState.selectConversation,
      renameConversation: conversationsState.renameConversation,
      deleteConversation: conversationsState.deleteConversation,
      uploadAttachment: attachments.uploadAttachment,
      approveAction: approvals.approveAction,
      rejectAction: approvals.rejectAction,
      startLiveVoiceSession,
      upsertVoiceMessage: conversationsState.upsertVoiceMessage,
      syncConversationState: conversationsState.syncConversationState,
      subscribeToolEvents: toolEvents.subscribe,
    }),
    [
      actions.interruptMessage,
      actions.sendMessage,
      approvals.approvalStatusesByToolExecution,
      approvals.approveAction,
      approvals.pendingApprovals,
      approvals.rejectAction,
      attachments.uploadAttachment,
      citations,
      conversationsState.conversations,
      conversationsState.currentConversationId,
      conversationsState.deleteConversation,
      conversationsState.loadConversations,
      conversationsState.messages,
      conversationsState.renameConversation,
      conversationsState.selectConversation,
      conversationsState.syncConversationState,
      conversationsState.upsertVoiceMessage,
      error,
      loading,
      startLiveVoiceSession,
      toolEvents.subscribe,
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
