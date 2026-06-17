import type {
  Agent,
  AgentContext,
  AgentResult,
  AgentRole,
  AgentStage,
  AgentStreamHooks,
} from './agents/types.js';

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
  }
}

const ROLE_STAGE: Record<AgentRole, AgentStage> = {
  orchestrator: 'routing',
  research: 'research',
  tool: 'tool',
  coding: 'coding',
  verifier: 'verifying',
};

export interface AgentOrchestratorOptions {
  // When true, low-risk prose answers stream directly to the user and the
  // verifier runs as a post-stream annotation instead of blocking the answer.
  streamingVerification?: boolean;
}

export class AgentOrchestrator {
  private agents: Map<AgentRole, Agent>;
  private readonly streamingVerification: boolean;

  constructor(agents: Agent[], options: AgentOrchestratorOptions = {}) {
    this.agents = new Map(agents.map((a) => [a.role, a]));
    this.streamingVerification = options.streamingVerification ?? true;
  }

  async run(context: AgentContext): Promise<AgentResult> {
    const orchestrator = this.agents.get('orchestrator');
    if (!orchestrator) throw new Error('Orchestrator agent not registered');
    const verifier = this.agents.get('verifier');
    const hooks = context.stream;

    let currentAgent: Agent = orchestrator;
    let currentContext: AgentContext = withAgentSinks(context, orchestrator.role, hooks);
    let result!: AgentResult;
    let accumulatedUsage: AgentResult['usage'];
    const maxDelegations = 5;

    for (let i = 0; i < maxDelegations; i++) {
      throwIfAborted(currentContext.signal);
      hooks?.onStage?.(ROLE_STAGE[currentAgent.role]);
      result = await currentAgent.execute(currentContext);
      accumulatedUsage = mergeUsage(accumulatedUsage, result.usage);
      if (accumulatedUsage !== result.usage) {
        result = { ...result, usage: accumulatedUsage };
      }
      if (!result.delegateTo) {
        if (!verifier || currentAgent.role === 'verifier') {
          hooks?.onStage?.('done');
          return result;
        }

        throwIfAborted(currentContext.signal);

        // Low-risk prose answers have already streamed to the user. Run the
        // verifier as a post-stream annotation (status + issues only) without
        // letting it replace the streamed answer text.
        const isLowRisk = result.toolCalls.length === 0 && !result.requiresApproval;
        if (hooks && this.streamingVerification && isLowRisk) {
          hooks.onStage?.('verifying');
          const verified = await verifier.execute({
            ...currentContext,
            previousResult: result,
            emitAnswerDelta: undefined,
            emitReasoningDelta: undefined,
          });
          hooks.onReasoningDelta?.('verifying', summarizeVerification(verified.verification));
          hooks.onStage?.('done');
          const finalUsage = mergeUsage(accumulatedUsage, verified.usage);
          return {
            ...result,
            verification: verified.verification,
            usage: finalUsage ?? result.usage,
          };
        }

        hooks?.onStage?.('verifying');
        const verified = await verifier.execute({ ...currentContext, previousResult: result });
        hooks?.onStage?.('done');
        const finalUsage = mergeUsage(accumulatedUsage, verified.usage);
        return finalUsage === verified.usage ? verified : { ...verified, usage: finalUsage };
      }

      const next = this.agents.get(result.delegateTo);
      if (!next) throw new Error(`Agent not found: ${result.delegateTo}`);

      currentContext = withAgentSinks(
        { ...currentContext, previousResult: result },
        next.role,
        hooks,
      );
      currentAgent = next;
    }

    throw new Error('Max delegation depth exceeded');
  }
}

/**
 * Wires the per-agent streaming sinks based on the agent's role. The agent that
 * produces the user-facing answer (orchestrator direct answer, research, coding)
 * streams to the answer channel; supporting agents (tool) stream to the
 * reasoning/thinking channel. The orchestrator gets both because it decides at
 * stream time whether it is answering or delegating.
 */
function withAgentSinks(
  context: AgentContext,
  role: AgentRole,
  hooks: AgentStreamHooks | undefined,
): AgentContext {
  if (!hooks) {
    return { ...context, emitAnswerDelta: undefined, emitReasoningDelta: undefined };
  }

  const onAnswer = wrapAnswerSink(hooks);
  const reasoningStage = ROLE_STAGE[role];
  const onReasoning = hooks.onReasoningDelta
    ? (delta: string) => hooks.onReasoningDelta?.(reasoningStage, delta)
    : undefined;

  switch (role) {
    case 'orchestrator':
      return { ...context, emitAnswerDelta: onAnswer, emitReasoningDelta: onReasoning };
    case 'research':
    case 'coding':
      return { ...context, emitAnswerDelta: onAnswer, emitReasoningDelta: undefined };
    case 'tool':
      return { ...context, emitAnswerDelta: undefined, emitReasoningDelta: onReasoning };
    default:
      return { ...context, emitAnswerDelta: undefined, emitReasoningDelta: undefined };
  }
}

/** Announces the `answering` stage on the first streamed answer token. */
function wrapAnswerSink(hooks: AgentStreamHooks): ((delta: string) => void) | undefined {
  if (!hooks.onAnswerDelta) {
    return undefined;
  }
  let announced = false;
  return (delta: string) => {
    if (!announced) {
      announced = true;
      hooks.onStage?.('answering');
    }
    hooks.onAnswerDelta?.(delta);
  };
}

function summarizeVerification(verification: AgentResult['verification']): string {
  if (!verification) {
    return 'Verification complete.';
  }
  if (verification.status === 'approved') {
    return 'Verified the response: approved.';
  }
  const issues = verification.issues.length > 0 ? ` Issues: ${verification.issues.join('; ')}` : '';
  return `Verification flagged the response for revision.${issues}`;
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
