import type { ModelProvider } from '../model-provider.js';
import { buildAgentSystemPrompt } from '../prompts.js';
import type { Agent, AgentContext, AgentResult } from './types.js';
import {
  parseToolCalls,
  requiresApprovalForCalls,
  toChatMessages,
  toSystemPromptContext,
  toToolDefinitions,
} from './helpers.js';

export class ActionAgent implements Agent {
  readonly role = 'action' as const;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly model?: string,
  ) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const systemPrompt = buildAgentSystemPrompt(this.role, toSystemPromptContext(context));
    const messages = [
      { role: 'system', content: systemPrompt } as const,
      ...toChatMessages(context.messageHistory),
    ];

    const completion = await this.modelProvider.complete({
      messages,
      model: this.model,
      tools: toToolDefinitions(context.availableTools),
      signal: context.signal,
    });

    const toolCalls = parseToolCalls(completion.toolCalls);

    return {
      response: completion.content,
      toolCalls,
      delegateTo: null,
      requiresApproval: requiresApprovalForCalls(toolCalls, context.availableTools),
    };
  }
}
