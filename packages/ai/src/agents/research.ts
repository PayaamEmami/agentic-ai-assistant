import type { ChatMessage } from '../types.js';
import type { ModelProvider } from '../model-provider.js';
import { buildAgentSystemPrompt, buildRetrievalAugmentedMessages } from '../prompts.js';
import type { Agent, AgentContext, AgentResult } from './types.js';
import { completeOrStream, toChatMessages, toSystemPromptContext } from './helpers.js';

export class ResearchAgent implements Agent {
  readonly role = 'research' as const;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly model?: string,
  ) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const systemPrompt = buildAgentSystemPrompt(this.role, toSystemPromptContext(context));
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...toChatMessages(context.messageHistory),
    ];

    const retrievedContext = context.retrievedContextProvider
      ? await context.retrievedContextProvider()
      : context.retrievedContext;
    const messages = buildRetrievalAugmentedMessages(baseMessages, retrievedContext);
    const completion = await completeOrStream(
      this.modelProvider,
      {
        messages,
        model: this.model,
        signal: context.signal,
      },
      context.emitAnswerDelta,
    );

    return {
      response: completion.content,
      toolCalls: [],
      delegateTo: null,
      requiresApproval: false,
      usage: completion.usage,
    };
  }
}
