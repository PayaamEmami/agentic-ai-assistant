export interface AssistantTextEvent {
  type: 'assistant.text.delta';
  conversationId: string;
  messageId: string;
  delta: string;
}

export interface AssistantTextDoneEvent {
  type: 'assistant.text.done';
  conversationId: string;
  messageId: string;
  fullText: string;
}

export interface AssistantInterruptedEvent {
  type: 'assistant.interrupted';
  conversationId: string;
  messageId: string;
  reason: 'user_cancelled';
}

export interface ToolStartEvent {
  type: 'tool.start';
  conversationId: string;
  toolExecutionId: string;
  toolName: string;
  input: unknown;
}

export interface ToolDoneEvent {
  type: 'tool.done';
  conversationId: string;
  toolExecutionId: string;
  toolName: string;
  output: unknown;
  status: 'completed' | 'failed';
}

export interface ToolProgressEvent {
  type: 'tool.progress';
  conversationId: string;
  toolExecutionId: string;
  toolName: string;
  phase:
    | 'clone'
    | 'plan'
    | 'edit'
    | 'validate'
    | 'commit'
    | 'push'
    | 'pr_update'
    | 'done';
  message: string;
}

export interface ApprovalRequestedEvent {
  type: 'approval.requested';
  conversationId: string;
  approvalId: string;
  toolExecutionId: string;
  description: string;
}

export interface ApprovalResolvedEvent {
  type: 'approval.resolved';
  conversationId: string;
  approvalId: string;
  toolExecutionId: string;
  status: 'approved' | 'rejected';
}

export interface CitationEvent {
  type: 'citation';
  conversationId: string;
  messageId: string;
  sourceId: string;
  excerpt: string;
  score: number;
}

export interface VoiceTranscriptEvent {
  type: 'voice.transcript';
  conversationId: string;
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
}

export interface VoiceSessionEndedEvent {
  type: 'voice.session.ended';
  conversationId: string;
  reason: string;
}

export interface ErrorEvent {
  type: 'error';
  conversationId: string;
  code: string;
  message: string;
}

export type RealtimeEvent =
  | AssistantTextEvent
  | AssistantTextDoneEvent
  | AssistantInterruptedEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolDoneEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | CitationEvent
  | VoiceTranscriptEvent
  | VoiceSessionEndedEvent
  | ErrorEvent;
