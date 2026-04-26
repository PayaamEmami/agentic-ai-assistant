import { describe, expect, it, vi } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import type { Agent, AgentContext, AgentResult, AgentRole } from './agents/types.js';

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    conversationId: 'conversation-1',
    userId: 'user-1',
    messageHistory: [],
    availableTools: [],
    retrievedContext: [],
    ...overrides,
  };
}

function result(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    response: 'done',
    toolCalls: [],
    delegateTo: null,
    requiresApproval: false,
    ...overrides,
  };
}

function agent(role: AgentRole, output: AgentResult): Agent {
  return {
    role,
    execute: vi.fn().mockResolvedValue(output),
  };
}

describe('AgentOrchestrator', () => {
  it('requires an orchestrator agent', async () => {
    const orchestrator = new AgentOrchestrator([]);

    await expect(orchestrator.run(context())).rejects.toThrow('Orchestrator agent not registered');
  });

  it('returns the orchestrator result when there is no verifier', async () => {
    const orchestratorAgent = agent('orchestrator', result({ response: 'final' }));
    const orchestrator = new AgentOrchestrator([orchestratorAgent]);

    await expect(orchestrator.run(context())).resolves.toMatchObject({ response: 'final' });
    expect(orchestratorAgent.execute).toHaveBeenCalledOnce();
  });

  it('passes non-delegated results to the verifier when registered', async () => {
    const draft = result({ response: 'draft' });
    const verified = result({ response: 'verified' });
    const orchestratorAgent = agent('orchestrator', draft);
    const verifierAgent = agent('verifier', verified);
    const orchestrator = new AgentOrchestrator([orchestratorAgent, verifierAgent]);

    await expect(orchestrator.run(context())).resolves.toBe(verified);
    expect(verifierAgent.execute).toHaveBeenCalledWith(
      expect.objectContaining({ previousResult: draft }),
    );
  });

  it('delegates to another agent and then verifies the delegated result', async () => {
    const delegated = result({ delegateTo: 'research', response: null });
    const researchResult = result({ response: 'researched' });
    const verified = result({ response: 'verified' });
    const orchestratorAgent = agent('orchestrator', delegated);
    const researchAgent = agent('research', researchResult);
    const verifierAgent = agent('verifier', verified);
    const orchestrator = new AgentOrchestrator([orchestratorAgent, researchAgent, verifierAgent]);

    await expect(orchestrator.run(context())).resolves.toBe(verified);
    expect(researchAgent.execute).toHaveBeenCalledWith(
      expect.objectContaining({ previousResult: delegated }),
    );
    expect(verifierAgent.execute).toHaveBeenCalledWith(
      expect.objectContaining({ previousResult: researchResult }),
    );
  });

  it('fails when a delegated agent is not registered', async () => {
    const orchestrator = new AgentOrchestrator([
      agent('orchestrator', result({ delegateTo: 'coding', response: null })),
    ]);

    await expect(orchestrator.run(context())).rejects.toThrow('Agent not found: coding');
  });

  it('checks abort signals before executing agents', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop now'));
    const orchestratorAgent = agent('orchestrator', result());
    const orchestrator = new AgentOrchestrator([orchestratorAgent]);

    await expect(orchestrator.run(context({ signal: controller.signal }))).rejects.toThrow(
      'stop now',
    );
    expect(orchestratorAgent.execute).not.toHaveBeenCalled();
  });

  it('limits delegation depth', async () => {
    const orchestratorAgent = agent(
      'orchestrator',
      result({ response: null, delegateTo: 'research' }),
    );
    const researchAgent = agent('research', result({ response: null, delegateTo: 'orchestrator' }));
    const orchestrator = new AgentOrchestrator([orchestratorAgent, researchAgent]);

    await expect(orchestrator.run(context())).rejects.toThrow('Max delegation depth exceeded');
    expect(orchestratorAgent.execute).toHaveBeenCalledTimes(3);
    expect(researchAgent.execute).toHaveBeenCalledTimes(2);
  });
});
