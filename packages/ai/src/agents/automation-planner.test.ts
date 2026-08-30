import { describe, expect, it, vi } from 'vitest';
import type { ChatProvider } from '../model-provider.js';
import {
  AUTOMATION_MIN_CONFIDENCE,
  AutomationPlannerAgent,
  type AutomationPlanRequest,
} from './automation-planner.js';

function providerReturning(content: string): ChatProvider {
  return {
    complete: vi.fn().mockResolvedValue({ content, usage: undefined }),
    streamComplete: vi.fn(),
  } as unknown as ChatProvider;
}

const request: AutomationPlanRequest = {
  boardName: 'Assistant',
  cards: [
    { id: 'card-1', title: 'Add a health endpoint', listName: 'To Do' },
    { id: 'card-2', title: 'Investigate latency', listName: 'To Do' },
  ],
  repos: [{ fullName: 'me/api' }, { fullName: 'me/web' }],
};

describe('AutomationPlannerAgent', () => {
  it('returns the selection when the planner picks a known card and repo', async () => {
    const agent = new AutomationPlannerAgent(
      providerReturning(
        JSON.stringify({
          decision: 'selected',
          cardId: 'card-1',
          repo: 'me/api',
          task: 'Add GET /health returning 200.',
          rationale: 'Concrete and scoped.',
          confidence: 0.9,
        }),
      ),
    );

    const plan = await agent.plan(request);

    expect(plan).toMatchObject({
      decision: 'selected',
      cardId: 'card-1',
      repo: 'me/api',
      confidence: 0.9,
    });
  });

  it('normalizes the repo name to the casing from the allowed list', async () => {
    const agent = new AutomationPlannerAgent(
      providerReturning(
        JSON.stringify({
          decision: 'selected',
          cardId: 'card-1',
          repo: 'ME/API',
          task: 'Add GET /health.',
          confidence: 0.8,
        }),
      ),
    );

    const plan = await agent.plan(request);

    expect(plan).toMatchObject({ decision: 'selected', repo: 'me/api' });
  });

  it('passes through an explicit abstention', async () => {
    const agent = new AutomationPlannerAgent(
      providerReturning(JSON.stringify({ decision: 'abstain', reason: 'Everything is vague.' })),
    );

    expect(await agent.plan(request)).toEqual({
      decision: 'abstain',
      reason: 'Everything is vague.',
    });
  });

  it('abstains when confidence is below the threshold', async () => {
    const agent = new AutomationPlannerAgent(
      providerReturning(
        JSON.stringify({
          decision: 'selected',
          cardId: 'card-1',
          repo: 'me/api',
          task: 'Add GET /health.',
          confidence: AUTOMATION_MIN_CONFIDENCE - 0.1,
        }),
      ),
    );

    const plan = await agent.plan(request);

    expect(plan.decision).toBe('abstain');
    expect(plan).toHaveProperty('reason', expect.stringContaining('below'));
  });

  it('abstains when the planner invents a card id', async () => {
    const agent = new AutomationPlannerAgent(
      providerReturning(
        JSON.stringify({
          decision: 'selected',
          cardId: 'card-999',
          repo: 'me/api',
          task: 'Do something.',
          confidence: 0.95,
        }),
      ),
    );

    const plan = await agent.plan(request);

    expect(plan.decision).toBe('abstain');
    expect(plan).toHaveProperty('reason', expect.stringContaining('card-999'));
  });

  it('abstains when the planner invents a repository', async () => {
    const agent = new AutomationPlannerAgent(
      providerReturning(
        JSON.stringify({
          decision: 'selected',
          cardId: 'card-1',
          repo: 'someone/else',
          task: 'Do something.',
          confidence: 0.95,
        }),
      ),
    );

    const plan = await agent.plan(request);

    expect(plan.decision).toBe('abstain');
    expect(plan).toHaveProperty('reason', expect.stringContaining('someone/else'));
  });

  it('abstains when the response is not valid JSON', async () => {
    const agent = new AutomationPlannerAgent(providerReturning('I think card 1 looks good!'));

    expect((await agent.plan(request)).decision).toBe('abstain');
  });

  it('tolerates a fenced JSON response', async () => {
    const agent = new AutomationPlannerAgent(
      providerReturning(
        '```json\n' +
          JSON.stringify({
            decision: 'selected',
            cardId: 'card-2',
            repo: 'me/web',
            task: 'Add a latency panel.',
            confidence: 0.7,
          }) +
          '\n```',
      ),
    );

    expect(await agent.plan(request)).toMatchObject({
      decision: 'selected',
      cardId: 'card-2',
    });
  });

  it('abstains without calling the model when every card is excluded', async () => {
    const provider = providerReturning('{}');
    const agent = new AutomationPlannerAgent(provider);

    const plan = await agent.plan({ ...request, excludedCardIds: ['card-1', 'card-2'] });

    expect(plan).toEqual({ decision: 'abstain', reason: 'No eligible cards on the board.' });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('abstains without calling the model when no repositories are available', async () => {
    const provider = providerReturning('{}');
    const agent = new AutomationPlannerAgent(provider);

    const plan = await agent.plan({ ...request, repos: [] });

    expect(plan.decision).toBe('abstain');
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('excludes already-worked cards from the prompt', async () => {
    const provider = providerReturning(
      JSON.stringify({ decision: 'abstain', reason: 'nothing left' }),
    );
    const agent = new AutomationPlannerAgent(provider);

    await agent.plan({ ...request, excludedCardIds: ['card-1'] });

    const prompt = vi.mocked(provider.complete).mock.calls[0]![0].messages[1]!.content;
    expect(prompt).toContain('card-2');
    expect(prompt).not.toContain('card-1');
  });
});
