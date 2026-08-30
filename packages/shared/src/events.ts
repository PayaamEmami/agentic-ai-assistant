export type AssistantStage =
  | 'routing'
  | 'retrieving'
  | 'research'
  | 'tool'
  | 'coding'
  | 'answering'
  | 'verifying'
  | 'done';

export interface AssistantTextEvent {
  type: 'assistant.text.delta';
  conversationId: string;
  messageId: string;
  delta: string;
}

export interface AssistantStatusEvent {
  type: 'assistant.status';
  conversationId: string;
  messageId: string;
  stage: AssistantStage;
}

export interface AssistantThinkingDeltaEvent {
  type: 'assistant.thinking.delta';
  conversationId: string;
  messageId: string;
  stage: AssistantStage;
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
  phase: 'clone' | 'plan' | 'edit' | 'validate' | 'commit' | 'push' | 'pr_update' | 'done';
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

export interface ErrorEvent {
  type: 'error';
  conversationId: string;
  code: string;
  message: string;
}

/**
 * Automation events are addressed by `conversationId` like every other realtime
 * event, so they reuse the existing per-conversation subscription and its
 * ownership check. Each run owns a hidden conversation for exactly this reason.
 */
export interface AutomationRunStatusEvent {
  type: 'automation.run.status';
  conversationId: string;
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'skipped' | 'failed';
  stage: string | null;
  pullRequestUrl?: string | null;
  skipReason?: string | null;
  error?: string | null;
}

export interface AutomationRunActivityEvent {
  type: 'automation.run.event';
  conversationId: string;
  runId: string;
  seq: number;
  at: string;
  kind: 'stage' | 'thought' | 'progress' | 'result';
  stage: string | null;
  message: string;
}

export type RealtimeEvent =
  | AssistantTextEvent
  | AssistantStatusEvent
  | AssistantThinkingDeltaEvent
  | AssistantTextDoneEvent
  | AssistantInterruptedEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolDoneEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | CitationEvent
  | AutomationRunStatusEvent
  | AutomationRunActivityEvent
  | ErrorEvent;
