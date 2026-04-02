import type { ChatMessage } from '../types.js';

export type AgentRole = 'orchestrator' | 'research' | 'action' | 'coding' | 'verifier';

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

export interface AgentContext {
  conversationId: string;
  userId: string;
  messageHistory: AgentHistoryMessage[];
  availableTools: Array<string | AgentToolContext>;
  retrievedContext: string[];
  personalContext?: string;
  activeConnectors?: string[];
  previousResult?: AgentResult;
  signal?: AbortSignal;
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
}

export interface Agent {
  role: AgentRole;
  execute(context: AgentContext): Promise<AgentResult>;
}
