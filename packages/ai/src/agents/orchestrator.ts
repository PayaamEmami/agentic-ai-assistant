import type { ModelProvider } from '../model-provider.js';
import { buildAgentSystemPrompt } from '../prompts.js';
import type { Agent, AgentContext, AgentResult } from './types.js';
import {
  completeOrStream,
  parseToolCalls,
  requiresApprovalForCalls,
  toChatMessages,
  toSystemPromptContext,
  toToolDefinitions,
} from './helpers.js';

const DELEGATE_DIRECTIVES = [
  '<delegate role="research" />',
  '<delegate role="coding" />',
  '<delegate role="tool" />',
];

/**
 * Routes streamed orchestrator output to the right sink. The orchestrator may
 * begin its reply with a `<delegate ... />` directive; until we can tell
 * whether the output is a direct answer or a delegation, tokens are buffered.
 * Once decided, a direct answer streams to the answer channel and a delegation
 * (plus any trailing reasoning) streams to the thinking channel.
 */
function createOrchestratorStreamSink(
  context: AgentContext,
): ((delta: string) => void) | undefined {
  const onAnswer = context.emitAnswerDelta;
  const onReasoning = context.emitReasoningDelta;
  if (!onAnswer && !onReasoning) {
    return undefined;
  }

  let buffer = '';
  let decision: 'answer' | 'delegate' | undefined;

  const flushAnswer = (text: string) => {
    if (text.length > 0) {
      onAnswer?.(text);
    }
  };

  return (delta: string) => {
    if (decision === 'answer') {
      flushAnswer(delta);
      return;
    }
    if (decision === 'delegate') {
      onReasoning?.(delta);
      return;
    }

    buffer += delta;
    const trimmed = buffer.trimStart();

    const matchedDirective = DELEGATE_DIRECTIVES.find((directive) =>
      trimmed.startsWith(directive),
    );
    if (matchedDirective) {
      decision = 'delegate';
      const remainder = trimmed.slice(matchedDirective.length).replace(/^[\r\n]+/, '');
      if (remainder.length > 0) {
        onReasoning?.(remainder);
      }
      buffer = '';
      return;
    }

    const couldBecomeDirective = DELEGATE_DIRECTIVES.some((directive) =>
      directive.startsWith(trimmed),
    );
    if (couldBecomeDirective && trimmed.length > 0) {
      return;
    }

    decision = 'answer';
    flushAnswer(buffer);
    buffer = '';
  };
}

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

    const completion = await completeOrStream(
      this.modelProvider,
      {
        messages,
        model: this.model,
        tools: toToolDefinitions(context.availableTools),
        signal: context.signal,
      },
      createOrchestratorStreamSink(context),
    );

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
