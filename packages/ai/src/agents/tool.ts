import type { ModelProvider } from '../model-provider.js';
import { buildAgentSystemPrompt } from '../prompts.js';
import type { Agent, AgentContext, AgentResult } from './types.js';
import {
  buildExplicitToolCallForRequest,
  completeOrStream,
  parseToolCalls,
  requiresApprovalForCalls,
  toChatMessages,
  toSystemPromptContext,
  toToolDefinitions,
} from './helpers.js';

export class ToolAgent implements Agent {
  readonly role = 'tool' as const;

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

    const completion = await completeOrStream(
      this.modelProvider,
      {
        messages,
        model: this.model,
        tools: toToolDefinitions(context.availableTools),
        signal: context.signal,
      },
      context.emitReasoningDelta,
    );

    let toolCalls = parseToolCalls(completion.toolCalls);
    let response = completion.content;
    if (toolCalls.length === 0) {
      const explicitToolCall = buildExplicitToolCallForRequest(context);
      if (explicitToolCall) {
        toolCalls = [explicitToolCall];
        response = null;
      }
    }

    return {
      response,
      toolCalls,
      delegateTo: null,
      requiresApproval: requiresApprovalForCalls(toolCalls, context.availableTools),
      usage: completion.usage,
    };
  }
}
