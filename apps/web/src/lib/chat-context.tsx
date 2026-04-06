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
import { api, buildWebSocketUrl, type ConversationSummaryResponse } from './api-client';
import { reportClientError } from './client-logging';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface AttachmentRefContentBlock {
  type: 'attachment_ref';
  attachmentId?: string;
  attachmentKind?: 'image' | 'document' | 'audio' | 'file';
  mimeType?: string;
  fileName?: string;
  indexedForRag?: boolean;
  documentId?: string | null;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  toolExecutionId?: string;
  toolName?: string;
  status?:
    | 'planned'
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'running'
    | 'completed'
    | 'failed';
  output?: unknown;
}

export interface CitationContentBlock {
  type: 'citation';
  sourceId?: string;
  title?: string;
  excerpt?: string;
  uri?: string;
}

export interface TranscriptContentBlock {
  type: 'transcript';
  text: string;
  durationMs?: number;
}

export interface BrowserSessionContentBlock {
  type: 'browser_session';
  browserSessionId?: string;
  mcpConnectionId?: string;
  purpose?: 'auth' | 'manual' | 'tool_takeover';
  status?:
    | 'pending'
    | 'active'
    | 'completed'
    | 'cancelled'
    | 'failed'
    | 'expired'
    | 'crashed';
  instanceLabel?: string;
  expiresAt?: string | null;
  endedAt?: string | null;
}

export interface StatusContentBlock {
  type: 'status';
  status: 'interrupted';
  label?: string;
}

export type MessageContentBlock =
  | TextContentBlock
  | AttachmentRefContentBlock
  | ToolResultContentBlock
  | CitationContentBlock
  | TranscriptContentBlock
  | BrowserSessionContentBlock
  | StatusContentBlock;

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: MessageContentBlock[];
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface ToolActivityItem {
  id: string;
  name: string;
  status: 'planned' | 'pending' | 'approved' | 'rejected' | 'running' | 'completed' | 'failed';
  output?: unknown;
  detail?: string;
}

export interface CitationItem {
  id: string;
  title: string;
  excerpt: string;
  uri?: string;
  sourceId?: string;
}

export interface UploadedAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: 'image' | 'document' | 'audio' | 'file';
  indexedForRag: boolean;
  documentId?: string | null;
}

export interface ChatLoadingState {
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  isSendingMessage: boolean;
  isInterruptingMessage: boolean;
  isUploadingAttachment: boolean;
  isLoadingApprovals: boolean;
}

interface ChatContextValue {
  conversations: ConversationSummary[];
  currentConversationId?: string;
  messages: ChatMessage[];
  pendingApprovals: PendingApproval[];
  approvalStatusesByToolExecution: ApprovalStatusByToolExecution;
  toolActivities: ToolActivityItem[];
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
  appendVoiceMessage: (conversationId: string, role: 'user' | 'assistant', text: string) => void;
  syncConversationState: (conversationId: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseRole(role: string): ChatRole {
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') {
    return role;
  }
  return 'assistant';
}

function parseToolStatus(
  value: unknown,
): 'planned' | 'pending' | 'approved' | 'rejected' | 'running' | 'completed' | 'failed' {
  if (
    value === 'planned' ||
    value === 'pending' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed'
  ) {
    return value;
  }
  return 'completed';
}

function parseApprovalStatus(value: unknown): 'pending' | 'approved' | 'rejected' | 'expired' {
  if (value === 'pending' || value === 'approved' || value === 'rejected' || value === 'expired') {
    return value;
  }
  return 'pending';
}

function normalizeContentBlock(raw: unknown): MessageContentBlock {
  if (!isRecord(raw)) {
    return { type: 'text', text: String(raw) };
  }

  const type = asString(raw.type);
  if (!type) {
    return {
      type: 'text',
      text: asString(raw.text) ?? stringify(raw),
    };
  }

  if (type === 'text') {
    return { type, text: asString(raw.text) ?? '' };
  }

  if (type === 'attachment_ref') {
    return {
      type,
      attachmentId: asString(raw.attachmentId),
      attachmentKind:
        raw.attachmentKind === 'image' ||
        raw.attachmentKind === 'document' ||
        raw.attachmentKind === 'audio' ||
        raw.attachmentKind === 'file'
          ? raw.attachmentKind
          : undefined,
      mimeType: asString(raw.mimeType),
      fileName: asString(raw.fileName),
      indexedForRag: typeof raw.indexedForRag === 'boolean' ? raw.indexedForRag : undefined,
      documentId: asString(raw.documentId) ?? null,
    };
  }

  if (type === 'tool_result') {
    return {
      type,
      toolExecutionId: asString(raw.toolExecutionId),
      toolName: asString(raw.toolName),
      status: parseToolStatus(raw.status),
      output: raw.output,
    };
  }

  if (type === 'citation') {
    return {
      type,
      sourceId: asString(raw.sourceId),
      title: asString(raw.title),
      excerpt: asString(raw.excerpt),
      uri: asString(raw.uri),
    };
  }

  if (type === 'transcript') {
    return {
      type,
      text: asString(raw.text) ?? '',
      durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : undefined,
    };
  }

  if (type === 'browser_session') {
    return {
      type,
      browserSessionId: asString(raw.browserSessionId),
      mcpConnectionId: asString(raw.mcpConnectionId),
      purpose:
        raw.purpose === 'auth' || raw.purpose === 'manual' || raw.purpose === 'tool_takeover'
          ? raw.purpose
          : undefined,
      status:
        raw.status === 'pending' ||
        raw.status === 'active' ||
        raw.status === 'completed' ||
        raw.status === 'cancelled' ||
        raw.status === 'failed' ||
        raw.status === 'expired' ||
        raw.status === 'crashed'
          ? raw.status
          : undefined,
      instanceLabel: asString(raw.instanceLabel),
      expiresAt: asString(raw.expiresAt) ?? null,
      endedAt: asString(raw.endedAt) ?? null,
    };
  }

  if (type === 'status') {
    return {
      type,
      status: raw.status === 'interrupted' ? 'interrupted' : 'interrupted',
      label: asString(raw.label),
    };
  }

  return { type: 'text', text: stringify(raw) };
}

function normalizeMessage(raw: {
  id: string;
  role: string;
  content: unknown[];
  createdAt: string;
}): ChatMessage {
  return {
    id: raw.id,
    role: parseRole(raw.role),
    content: raw.content.map(normalizeContentBlock),
    createdAt: raw.createdAt,
  };
}

function sortConversations(items: ConversationSummary[]): ConversationSummary[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime();
    const bTime = new Date(b.updatedAt).getTime();
    return bTime - aTime;
  });
}

function normalizeConversationSummary(
  conversation: ConversationSummaryResponse,
): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function buildConversationTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Untitled conversation';
  }

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77).trimEnd()}...`;
}

function upsertConversation(
  conversations: ConversationSummary[],
  conversation: ConversationSummary,
): ConversationSummary[] {
  const next = conversations.filter((item) => item.id !== conversation.id);
  next.push(conversation);
  return sortConversations(next);
}

function mergeConversations(
  local: ConversationSummary[],
  remote: ConversationSummary[],
): ConversationSummary[] {
  const map = new Map<string, ConversationSummary>();

  for (const item of remote) {
    map.set(item.id, item);
  }

  for (const item of local) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }

  return sortConversations(Array.from(map.values()));
}

function extractToolActivities(messages: ChatMessage[]): ToolActivityItem[] {
  const byId = new Map<string, ToolActivityItem>();

  for (const message of messages) {
    message.content.forEach((block, index) => {
      if (block.type !== 'tool_result') {
        return;
      }

      const id = block.toolExecutionId ?? `${message.id}-${index}`;
      byId.set(id, {
        id,
        name: block.toolName ?? 'Tool',
        status: parseToolStatus(block.status),
        output: block.output,
        detail: undefined,
      });
    });
  }

  return Array.from(byId.values());
}

function extractCitations(messages: ChatMessage[]): CitationItem[] {
  const citations: CitationItem[] = [];

  for (const message of messages) {
    message.content.forEach((block, index) => {
      if (block.type !== 'citation') {
        return;
      }

      citations.push({
        id: `${message.id}-${index}`,
        title: block.title ?? block.sourceId ?? 'Source',
        excerpt: block.excerpt ?? '',
        uri: block.uri,
        sourceId: block.sourceId,
      });
    });
  }

  return citations;
}

function createOptimisticUserMessage(
  content: string,
  attachments: UploadedAttachment[],
): ChatMessage {
  const attachmentBlocks: AttachmentRefContentBlock[] = attachments.map((attachment) => ({
    type: 'attachment_ref',
    attachmentId: attachment.id,
    attachmentKind: attachment.kind,
    mimeType: attachment.mimeType,
    fileName: attachment.name,
    indexedForRag: attachment.indexedForRag,
    documentId: attachment.documentId ?? null,
  }));

  return {
    id: `local-user-${crypto.randomUUID()}`,
    role: 'user',
    content: [
      {
        type: 'text',
        text: content,
      },
      ...attachmentBlocks,
    ],
    createdAt: new Date().toISOString(),
  };
}

function createFallbackAssistantMessage(messageId: string): ChatMessage {
  return {
    id: `local-assistant-${messageId}`,
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'Assistant response received.',
      },
    ],
    createdAt: new Date().toISOString(),
  };
}

function createOptimisticVoiceMessage(role: 'user' | 'assistant', text: string): ChatMessage {
  return {
    id: `local-voice-${role}-${crypto.randomUUID()}`,
    role,
    content: [
      {
        type: 'text',
        text,
      },
    ],
    createdAt: new Date().toISOString(),
  };
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuthContext();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvalStatusesByToolExecution, setApprovalStatusesByToolExecution] =
    useState<ApprovalStatusByToolExecution>({});
  const [toolActivities, setToolActivities] = useState<ToolActivityItem[]>([]);
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

      const clientRunId = crypto.randomUUID();
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
            id: `local-error-${crypto.randomUUID()}`,
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

  const appendVoiceMessage = useCallback(
    (conversationId: string, role: 'user' | 'assistant', text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      setCurrentConversationId(conversationId);
      setMessages((previous) => [...previous, createOptimisticVoiceMessage(role, trimmed)]);
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
        case 'tool.start':
        case 'tool.progress':
        case 'tool.done':
          if (parsed.type === 'tool.progress') {
            const progress = parsed as {
              toolExecutionId?: string;
              toolName?: string;
              message?: string;
            };
            setToolActivities((previous) => {
              const id = progress.toolExecutionId ?? crypto.randomUUID();
              const next = previous.filter((item) => item.id !== id);
              next.push({
                id,
                name: progress.toolName ?? 'Tool',
                status: 'running',
                detail: progress.message,
              });
              return next;
            });
            return;
          }
          void refreshConversation(currentConversationId);
          return;
        case 'approval.requested':
          void loadPendingApprovals();
          void refreshConversation(currentConversationId);
          return;
        case 'approval.resolved': {
          const resolved = parsed as {
            toolExecutionId?: string;
            status?: 'approved' | 'rejected';
          };
          if (
            resolved.toolExecutionId &&
            (resolved.status === 'approved' || resolved.status === 'rejected')
          ) {
            setApprovalStatusesByToolExecution((previous) => ({
              ...previous,
              [resolved.toolExecutionId as string]: resolved.status as 'approved' | 'rejected',
            }));
          }
          void loadPendingApprovals();
          void refreshConversation(currentConversationId);
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
  }, [currentConversationId, loadPendingApprovals, refreshConversation, token]);

  useEffect(() => {
    setToolActivities(extractToolActivities(messages));
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
      toolActivities,
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
      appendVoiceMessage,
      syncConversationState,
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
      appendVoiceMessage,
      syncConversationState,
      toolActivities,
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
