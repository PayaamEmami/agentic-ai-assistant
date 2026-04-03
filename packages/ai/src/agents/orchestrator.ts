import type { ModelProvider } from '../model-provider.js';
import { buildAgentSystemPrompt } from '../prompts.js';
import type { Agent, AgentContext, AgentResult } from './types.js';
import {
  parseToolCalls,
  requiresApprovalForCalls,
  shouldDelegateToCoding,
  shouldDelegateToResearch,
  toChatMessages,
  toSystemPromptContext,
  toToolDefinitions,
} from './helpers.js';

export class OrchestratorAgent implements Agent {
  readonly role = 'orchestrator' as const;

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
    const delegateTo = shouldDelegateToCoding(context)
      ? 'coding'
      : toolCalls.length > 0
        ? 'tool'
        : shouldDelegateToResearch(context)
          ? 'research'
          : null;

    return {
      response: completion.content,
      toolCalls,
      delegateTo,
      requiresApproval: requiresApprovalForCalls(toolCalls, context.availableTools),
    };
  }
}
