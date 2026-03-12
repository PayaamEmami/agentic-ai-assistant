'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from './api-client';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ImageRefContentBlock {
  type: 'image_ref';
  attachmentId?: string;
  mimeType?: string;
  fileName?: string;
}

export interface ToolResultContentBlock {
  type: 'tool_result';
  toolExecutionId?: string;
  toolName?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
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

export type MessageContentBlock =
  | TextContentBlock
  | ImageRefContentBlock
  | ToolResultContentBlock
  | CitationContentBlock
  | TranscriptContentBlock;

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
  description: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
}

export interface ToolActivityItem {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: unknown;
}

export interface CitationItem {
  id: string;
  title: string;
  excerpt: string;
  uri?: string;
  sourceId?: string;
}

export interface ChatLoadingState {
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  isSendingMessage: boolean;
  isUploadingImage: boolean;
  isLoadingApprovals: boolean;
}

interface ChatContextValue {
  conversations: ConversationSummary[];
  currentConversationId?: string;
  messages: ChatMessage[];
  pendingApprovals: PendingApproval[];
  toolActivities: ToolActivityItem[];
  citations: CitationItem[];
  loading: ChatLoadingState;
  error: string | null;
  sendMessage: (content: string, attachmentIds?: string[]) => Promise<void>;
  loadConversations: () => Promise<void>;
  selectConversation: (conversationId?: string) => Promise<void>;
  uploadImage: (file: File) => Promise<string>;
  approveAction: (approvalId: string) => Promise<void>;
  rejectAction: (approvalId: string) => Promise<void>;
  startVoiceSession: () => Promise<void>;
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

function parseToolStatus(value: unknown): 'pending' | 'running' | 'completed' | 'failed' {
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
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

  if (type === 'image_ref') {
    return {
      type,
      attachmentId: asString(raw.attachmentId),
      mimeType: asString(raw.mimeType),
      fileName: asString(raw.fileName),
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
  const activities: ToolActivityItem[] = [];

  for (const message of messages) {
    message.content.forEach((block, index) => {
      if (block.type !== 'tool_result') {
        return;
      }

      activities.push({
        id: block.toolExecutionId ?? `${message.id}-${index}`,
        name: block.toolName ?? 'Tool',
        status: parseToolStatus(block.status),
        output: block.output,
      });
    });
  }

  return activities;
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

function createOptimisticUserMessage(content: string, attachmentIds: string[]): ChatMessage {
  const imageBlocks: ImageRefContentBlock[] = attachmentIds.map((attachmentId) => ({
    type: 'image_ref',
    attachmentId,
  }));

  return {
    id: `local-user-${crypto.randomUUID()}`,
    role: 'user',
    content: [
      {
        type: 'text',
        text: content,
      },
      ...imageBlocks,
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

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [toolActivities, setToolActivities] = useState<ToolActivityItem[]>([]);
  const [citations, setCitations] = useState<CitationItem[]>([]);

  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPendingApprovals = useCallback(async () => {
    setIsLoadingApprovals(true);
    try {
      const response = await api.approvals.listPending();
      const approvals = response.approvals
        .map((item) => ({
          id: item.id,
          description: item.description,
          status: parseApprovalStatus(item.status),
          createdAt: item.createdAt ?? new Date().toISOString(),
        }))
        .filter((item) => item.status === 'pending');
      setPendingApprovals(approvals);
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
      const remoteConversations: ConversationSummary[] = response.conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      }));
      setConversations((previous) => mergeConversations(previous, remoteConversations));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load conversations');
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  const selectConversation = useCallback(async (conversationId?: string) => {
    setError(null);
    setCurrentConversationId(conversationId);

    if (!conversationId) {
      setMessages([]);
      return;
    }

    setIsLoadingMessages(true);
    try {
      const response = await api.chat.getConversation(conversationId);
      const nextMessages = response.messages.map(normalizeMessage);
      setMessages(nextMessages);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load conversation');
      setMessages([]);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (content: string, attachmentIds: string[] = []) => {
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return;
      }

      setError(null);
      setIsSendingMessage(true);

      const optimisticUserMessage = createOptimisticUserMessage(trimmedContent, attachmentIds);
      setMessages((previous) => [...previous, optimisticUserMessage]);

      try {
        const response = await api.chat.send(
          trimmedContent,
          currentConversationId,
          attachmentIds.length > 0 ? attachmentIds : undefined,
        );

        const timestamp = new Date().toISOString();
        setCurrentConversationId(response.conversationId);
        setConversations((previous) =>
          upsertConversation(previous, {
            id: response.conversationId,
            title: trimmedContent.slice(0, 80),
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        );

        let hasAssistantMessage = false;
        try {
          const detail = await api.chat.getConversation(response.conversationId);
          const nextMessages = detail.messages.map(normalizeMessage);
          if (nextMessages.length > 0) {
            hasAssistantMessage = nextMessages.some((message) => message.role === 'assistant');
            setMessages(nextMessages);
          }
        } catch (detailError) {
          console.error('Failed to refresh conversation after send', detailError);
        }

        if (!hasAssistantMessage) {
          setMessages((previous) => [...previous, createFallbackAssistantMessage(response.messageId)]);
        }

        await Promise.all([loadConversations(), loadPendingApprovals()]);
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : 'Failed to send message';
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
        setIsSendingMessage(false);
      }
    },
    [currentConversationId, loadConversations, loadPendingApprovals],
  );

  const uploadImage = useCallback(async (file: File) => {
    setError(null);
    setIsUploadingImage(true);
    try {
      const response = await api.upload.uploadFile(file);
      return response.attachmentId;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to upload image');
      throw requestError;
    } finally {
      setIsUploadingImage(false);
    }
  }, []);

  const decideApproval = useCallback(async (approvalId: string, status: 'approved' | 'rejected') => {
    setError(null);
    try {
      await api.approvals.decide(approvalId, status);
      setPendingApprovals((previous) => previous.filter((item) => item.id !== approvalId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to decide approval');
      throw requestError;
    }
  }, []);

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

  const startVoiceSession = useCallback(async () => {
    console.log('Starting voice session', { conversationId: currentConversationId });
  }, [currentConversationId]);

  useEffect(() => {
    void loadConversations();
    void loadPendingApprovals();
  }, [loadConversations, loadPendingApprovals]);

  useEffect(() => {
    setToolActivities(extractToolActivities(messages));
    setCitations(extractCitations(messages));
  }, [messages]);

  const loading = useMemo<ChatLoadingState>(
    () => ({
      isLoadingConversations,
      isLoadingMessages,
      isSendingMessage,
      isUploadingImage,
      isLoadingApprovals,
    }),
    [
      isLoadingApprovals,
      isLoadingConversations,
      isLoadingMessages,
      isSendingMessage,
      isUploadingImage,
    ],
  );

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      currentConversationId,
      messages,
      pendingApprovals,
      toolActivities,
      citations,
      loading,
      error,
      sendMessage,
      loadConversations,
      selectConversation,
      uploadImage,
      approveAction,
      rejectAction,
      startVoiceSession,
    }),
    [
      approveAction,
      citations,
      conversations,
      currentConversationId,
      error,
      loadConversations,
      loading,
      messages,
      pendingApprovals,
      rejectAction,
      selectConversation,
      sendMessage,
      startVoiceSession,
      toolActivities,
      uploadImage,
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
