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

export class OrchestratorAgent implements Agent {
  readonly role = 'orchestrator' as const;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly model?: string,
  ) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const systemPrompt =
      buildAgentSystemPrompt(this.role, toSystemPromptContext(context)) +
      '\n\nWhen another specialist should handle the request, start your reply with exactly one line in the form ' +
      '<delegate role="research" />, <delegate role="coding" />, or <delegate role="tool" />. ' +
      'If you can answer directly, do not emit a delegate tag.';
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
    const routed = stripDelegateDirective(completion.content);
    const delegateTo = toolCalls.length > 0 ? 'tool' : routed.delegateTo;

    return {
      response: routed.response,
      toolCalls,
      delegateTo,
      requiresApproval: requiresApprovalForCalls(toolCalls, context.availableTools),
      usage: completion.usage,
    };
  }
}

function stripDelegateDirective(content: string | null): {
  response: string | null;
  delegateTo: AgentResult['delegateTo'];
} {
  if (!content) {
    return { response: null, delegateTo: null };
  }

  const match = content.match(/^\s*<delegate role="(research|coding|tool)" \/>[\r\n]*/);
  if (!match) {
    return { response: content, delegateTo: null };
  }

  const response = content.slice(match[0].length).trim();
  return {
    response: response.length > 0 ? response : null,
    delegateTo: match[1] as AgentResult['delegateTo'],
  };
}
