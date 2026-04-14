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

export interface BrowserSessionCreatedEvent {
  type: 'browser.session.created';
  conversationId: string;
  browserSessionId: string;
  messageId: string | null;
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

export interface BrowserPageEvent {
  pageId: string;
  url: string;
  title: string;
  isSelected: boolean;
}

export interface BrowserSessionAttachedEvent {
  type: 'browser.session.attached';
  sessionId: string;
  mcpProfileId: string;
  status: string;
  purpose: 'sign_in' | 'manual' | 'handoff';
  selectedPageId: string | null;
  controlGranted: boolean;
  pages: BrowserPageEvent[];
  viewport: { width: number; height: number } | null;
}

export interface BrowserSessionUpdatedEvent {
  type: 'browser.session.updated';
  sessionId: string;
  status: string;
  selectedPageId: string | null;
  pages: BrowserPageEvent[];
  viewport: { width: number; height: number } | null;
}

export interface BrowserFrameMetaEvent {
  type: 'browser.frame.meta';
  sessionId: string;
  pageId: string;
  mimeType: string;
  width: number;
  height: number;
  timestamp: string;
}

export interface BrowserControlStateEvent {
  type: 'browser.control.state';
  sessionId: string;
  controlGranted: boolean;
}

export interface BrowserSessionEndedEvent {
  type: 'browser.session.ended';
  sessionId: string;
  status: 'completed' | 'cancelled' | 'expired' | 'failed' | 'crashed';
  reason: string;
}

export interface BrowserErrorEvent {
  type: 'browser.error';
  sessionId?: string;
  code: string;
  message: string;
}

export interface BrowserAttachRequestEvent {
  type: 'browser.attach';
  sessionId: string;
}

export interface BrowserHeartbeatEvent {
  type: 'browser.heartbeat';
  sessionId: string;
}

export interface BrowserControlRequestEvent {
  type: 'browser.control.request';
  sessionId: string;
}

export interface BrowserResizeEvent {
  type: 'browser.resize';
  sessionId: string;
  width: number;
  height: number;
}

export interface BrowserNavigateEvent {
  type: 'browser.navigate';
  sessionId: string;
  url: string;
}

export interface BrowserPageSelectEvent {
  type: 'browser.page.select';
  sessionId: string;
  pageId: string;
}

export interface BrowserHistoryEvent {
  type: 'browser.history';
  sessionId: string;
  action: 'back' | 'forward' | 'reload';
}

export interface BrowserPointerEvent {
  type: 'browser.pointer';
  sessionId: string;
  action: 'move' | 'down' | 'up';
  x: number;
  y: number;
  button?: 'left' | 'middle' | 'right';
  buttons?: number;
}

export interface BrowserWheelEvent {
  type: 'browser.wheel';
  sessionId: string;
  deltaX: number;
  deltaY: number;
  x: number;
  y: number;
}

export interface BrowserKeyboardEvent {
  type: 'browser.keyboard';
  sessionId: string;
  action: 'down' | 'up' | 'press';
  key: string;
  text?: string;
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
  | BrowserSessionCreatedEvent
  | CitationEvent
  | VoiceTranscriptEvent
  | VoiceSessionEndedEvent
  | ErrorEvent;

export type BrowserServerEvent =
  | BrowserSessionAttachedEvent
  | BrowserSessionUpdatedEvent
  | BrowserFrameMetaEvent
  | BrowserControlStateEvent
  | BrowserSessionEndedEvent
  | BrowserErrorEvent;

export type BrowserClientEvent =
  | BrowserAttachRequestEvent
  | BrowserHeartbeatEvent
  | BrowserControlRequestEvent
  | BrowserResizeEvent
  | BrowserNavigateEvent
  | BrowserPageSelectEvent
  | BrowserHistoryEvent
  | BrowserPointerEvent
  | BrowserWheelEvent
  | BrowserKeyboardEvent;
