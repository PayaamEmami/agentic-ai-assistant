import type { ChatMessage } from '../types.js';
import type { ModelProvider } from '../model-provider.js';
import { buildAgentSystemPrompt, buildRetrievalAugmentedMessages } from '../prompts.js';
import type { Agent, AgentContext, AgentResult } from './types.js';
import { toChatMessages, toSystemPromptContext } from './helpers.js';

export class ResearchAgent implements Agent {
  readonly role = 'research' as const;

  constructor(private readonly modelProvider: ModelProvider, private readonly model?: string) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const systemPrompt = buildAgentSystemPrompt(this.role, toSystemPromptContext(context));
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...toChatMessages(context.messageHistory),
    ];

    const messages = buildRetrievalAugmentedMessages(baseMessages, context.retrievedContext);
    const completion = await this.modelProvider.complete({
      messages,
      model: this.model,
    });

    return {
      response: completion.content,
      toolCalls: [],
      delegateTo: null,
      requiresApproval: false,
    };
  }
}
