import type { Agent, AgentContext, AgentResult } from './types.js';

export class OrchestratorAgent implements Agent {
  readonly role = 'orchestrator' as const;

  async execute(_context: AgentContext): Promise<AgentResult> {
    // TODO: implement orchestrator logic — analyse intent, delegate to sub-agents
    return { response: null, toolCalls: [], delegateTo: null, requiresApproval: false };
  }
}
