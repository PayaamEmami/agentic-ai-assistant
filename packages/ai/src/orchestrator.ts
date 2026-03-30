import type { Agent, AgentContext, AgentResult, AgentRole } from './agents/types.js';

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
  }
}

export class AgentOrchestrator {
  private agents: Map<AgentRole, Agent>;

  constructor(agents: Agent[]) {
    this.agents = new Map(agents.map((a) => [a.role, a]));
  }

  async run(context: AgentContext): Promise<AgentResult> {
    const orchestrator = this.agents.get('orchestrator');
    if (!orchestrator) throw new Error('Orchestrator agent not registered');
    const verifier = this.agents.get('verifier');

    let currentAgent: Agent = orchestrator;
    let currentContext: AgentContext = context;
    let result!: AgentResult;
    const maxDelegations = 5;

    for (let i = 0; i < maxDelegations; i++) {
      throwIfAborted(currentContext.signal);
      result = await currentAgent.execute(currentContext);
      if (!result.delegateTo) {
        if (!verifier || currentAgent.role === 'verifier') {
          return result;
        }

        throwIfAborted(currentContext.signal);
        return verifier.execute({ ...currentContext, previousResult: result });
      }

      const next = this.agents.get(result.delegateTo);
      if (!next) throw new Error(`Agent not found: ${result.delegateTo}`);

      currentContext = { ...currentContext, previousResult: result };
      currentAgent = next;
    }

    throw new Error('Max delegation depth exceeded');
  }
}
