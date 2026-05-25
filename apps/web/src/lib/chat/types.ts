import type { ToolEventListener } from './tool-events';
import type {
  ChatMessage,
  CitationItem,
  ConversationSummary,
  UploadedAttachment,
} from './model/index';

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

export interface ChatContextValue {
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
