import type { ChatMessage } from '../types.js';
import type { ModelProvider } from '../model-provider.js';
import { buildAgentSystemPrompt } from '../prompts.js';
import type { Agent, AgentContext, AgentResult } from './types.js';
import { toChatMessages, toSystemPromptContext } from './helpers.js';

export class VerifierAgent implements Agent {
  readonly role = 'verifier' as const;

  constructor(private readonly modelProvider: ModelProvider, private readonly model?: string) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const systemPrompt = buildAgentSystemPrompt(this.role, toSystemPromptContext(context));
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...toChatMessages(context.messageHistory),
      buildPreviousResultMessage(context),
    ];

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

function buildPreviousResultMessage(context: AgentContext): ChatMessage {
  if (!context.previousResult) {
    return {
      role: 'user',
      content: 'No previous agent result was provided to verify.',
    };
  }

  return {
    role: 'user',
    content: `Validate this prior agent result against user intent and safety constraints:\n${JSON.stringify(context.previousResult)}`,
  };
}
