import type { Agent, AgentContext, AgentResult, AgentRole } from './agents/types.js';

export class AgentOrchestrator {
  private agents: Map<AgentRole, Agent>;

  constructor(agents: Agent[]) {
    this.agents = new Map(agents.map((a) => [a.role, a]));
  }

  async run(context: AgentContext): Promise<AgentResult> {
    const orchestrator = this.agents.get('orchestrator');
    if (!orchestrator) throw new Error('Orchestrator agent not registered');

    let currentAgent: Agent = orchestrator;
    let result!: AgentResult;
    const maxDelegations = 5;

    for (let i = 0; i < maxDelegations; i++) {
      result = await currentAgent.execute(context);
      if (!result.delegateTo) return result;

      const next = this.agents.get(result.delegateTo);
      if (!next) throw new Error(`Agent not found: ${result.delegateTo}`);
      currentAgent = next;
    }

    throw new Error('Max delegation depth exceeded');
  }
}
