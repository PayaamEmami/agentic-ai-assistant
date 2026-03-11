export type AgentRole = 'orchestrator' | 'research' | 'action' | 'verifier';

export interface AgentContext {
  conversationId: string;
  userId: string;
  messageHistory: Array<{ role: string; content: string }>;
  availableTools: string[];
  retrievedContext: string[];
}

export interface AgentResult {
  response: string | null;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  delegateTo: AgentRole | null;
  requiresApproval: boolean;
}

export interface Agent {
  role: AgentRole;
  execute(context: AgentContext): Promise<AgentResult>;
}
