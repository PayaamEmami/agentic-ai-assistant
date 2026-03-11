import type { Agent, AgentContext, AgentResult } from './types.js';

export class VerifierAgent implements Agent {
  readonly role = 'verifier' as const;

  async execute(_context: AgentContext): Promise<AgentResult> {
    // TODO: implement verification logic — validate outputs, check constraints
    return { response: null, toolCalls: [], delegateTo: null, requiresApproval: false };
  }
}
