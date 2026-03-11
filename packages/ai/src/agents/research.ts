import type { Agent, AgentContext, AgentResult } from './types.js';

export class ResearchAgent implements Agent {
  readonly role = 'research' as const;

  async execute(_context: AgentContext): Promise<AgentResult> {
    // TODO: implement research logic — retrieve context, search knowledge base
    return { response: null, toolCalls: [], delegateTo: null, requiresApproval: false };
  }
}
