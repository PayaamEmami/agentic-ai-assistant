import type { ChatMessage } from '../types.js';

export type AgentRole = 'orchestrator' | 'research' | 'tool' | 'coding' | 'verifier';

export interface AgentHistoryMessage {
  role: string;
  content: ChatMessage['content'];
  name?: string;
  toolCallId?: string;
}

export interface AgentToolContext {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  requiresApproval?: boolean;
}

export type AgentStage =
  | 'routing'
  | 'retrieving'
  | 'research'
  | 'tool'
  | 'coding'
  | 'answering'
  | 'verifying'
  | 'done';

export interface AgentStreamHooks {
  onStage?: (stage: AgentStage) => void;
  onReasoningDelta?: (stage: AgentStage, delta: string) => void;
  onAnswerDelta?: (delta: string) => void;
}

export interface AgentContext {
  conversationId: string;
  userId: string;
  messageHistory: AgentHistoryMessage[];
  availableTools: Array<string | AgentToolContext>;
  retrievedContext: string[];
  personalContext?: string;
  activeApps?: string[];
  previousResult?: AgentResult;
  signal?: AbortSignal;
  // When present, retrieved context is resolved lazily so retrieval can run
  // concurrently with the orchestrator's routing pass. Agents that consume
  // retrieved context (research, verifier) await this instead of `retrievedContext`.
  retrievedContextProvider?: () => Promise<string[]>;
  // Streaming hooks provided by the caller (chat service). The orchestrator
  // reads these to wire per-agent sinks and emit stage transitions.
  stream?: AgentStreamHooks;
  // Streaming sinks wired by the orchestrator on a per-agent basis. An agent
  // streams its model output to whichever sink is set for it.
  emitReasoningDelta?: (delta: string) => void;
  emitAnswerDelta?: (delta: string) => void;
}

export interface AgentVerificationResult {
  status: 'approved' | 'revise';
  issues: string[];
}

export interface AgentResult {
  response: string | null;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  delegateTo: AgentRole | null;
  requiresApproval: boolean;
  verification?: AgentVerificationResult;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface Agent {
  role: AgentRole;
  execute(context: AgentContext): Promise<AgentResult>;
}
