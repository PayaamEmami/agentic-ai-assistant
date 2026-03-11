import type { Agent, AgentContext, AgentResult } from './types.js';

export class ActionAgent implements Agent {
  readonly role = 'action' as const;

  async execute(_context: AgentContext): Promise<AgentResult> {
    // TODO: implement action logic — execute tools, perform side-effects
    return { response: null, toolCalls: [], delegateTo: null, requiresApproval: false };
  }
}
