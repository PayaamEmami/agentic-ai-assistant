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
    let accumulatedUsage: AgentResult['usage'];
    const maxDelegations = 5;

    for (let i = 0; i < maxDelegations; i++) {
      throwIfAborted(currentContext.signal);
      result = await currentAgent.execute(currentContext);
      accumulatedUsage = mergeUsage(accumulatedUsage, result.usage);
      if (accumulatedUsage !== result.usage) {
        result = { ...result, usage: accumulatedUsage };
      }
      if (!result.delegateTo) {
        if (!verifier || currentAgent.role === 'verifier') {
          return result;
        }

        throwIfAborted(currentContext.signal);
        const verified = await verifier.execute({ ...currentContext, previousResult: result });
        const finalUsage = mergeUsage(accumulatedUsage, verified.usage);
        return finalUsage === verified.usage ? verified : { ...verified, usage: finalUsage };
      }

      const next = this.agents.get(result.delegateTo);
      if (!next) throw new Error(`Agent not found: ${result.delegateTo}`);

      currentContext = { ...currentContext, previousResult: result };
      currentAgent = next;
    }

    throw new Error('Max delegation depth exceeded');
  }
}

function mergeUsage(
  left?: AgentResult['usage'],
  right?: AgentResult['usage'],
): AgentResult['usage'] | undefined {
  if (!left && !right) {
    return undefined;
  }
  return {
    promptTokens: (left?.promptTokens ?? 0) + (right?.promptTokens ?? 0),
    completionTokens: (left?.completionTokens ?? 0) + (right?.completionTokens ?? 0),
    totalTokens: (left?.totalTokens ?? 0) + (right?.totalTokens ?? 0),
  };
}
