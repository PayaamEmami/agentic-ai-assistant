import type { ChatMessage } from '../types.js';
import type { ModelProvider } from '../model-provider.js';
import { buildAgentSystemPrompt, buildRetrievalAugmentedMessages } from '../prompts.js';
import type { Agent, AgentContext, AgentResult } from './types.js';
import { toChatMessages, toSystemPromptContext } from './helpers.js';

export class VerifierAgent implements Agent {
  readonly role = 'verifier' as const;

  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly model?: string,
  ) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    if (!context.previousResult) {
      return {
        response: null,
        toolCalls: [],
        delegateTo: null,
        requiresApproval: false,
      };
    }

    // Do not "revise" intermediate responses while tool work is still pending.
    if (context.previousResult.toolCalls.length > 0) {
      return {
        response: context.previousResult.response,
        toolCalls: context.previousResult.toolCalls,
        delegateTo: null,
        requiresApproval: context.previousResult.requiresApproval,
        verification: context.previousResult.verification,
      };
    }

    const systemPrompt = buildAgentSystemPrompt(this.role, toSystemPromptContext(context));
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...toChatMessages(context.messageHistory),
      buildPreviousResultMessage(context),
    ];
    const verifierMessages = buildRetrievalAugmentedMessages(messages, context.retrievedContext);

    const completion = await this.modelProvider.complete({
      messages: verifierMessages,
      model: this.model,
      signal: context.signal,
    });

    const verified = parseVerificationContent(completion.content, context.previousResult);
    if (!verified.valid) {
      return {
        response: context.previousResult.response,
        toolCalls: context.previousResult.toolCalls,
        delegateTo: null,
        requiresApproval: context.previousResult.requiresApproval,
        verification: context.previousResult.verification,
      };
    }

    const response =
      verified.status === 'revise' ? verified.response : context.previousResult.response;

    return {
      response,
      toolCalls: context.previousResult.toolCalls,
      delegateTo: null,
      requiresApproval: context.previousResult.requiresApproval,
      verification: {
        status: verified.status,
        issues: verified.issues,
      },
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
    content:
      'Validate this prior agent result against user intent, safety constraints, and any retrieved context already provided in the prompt. ' +
      'Treat retrieved context as pre-authorized read-only evidence; only flag access claims that go beyond that evidence or imply operations that did not occur. ' +
      'Reply with JSON only.\n' +
      JSON.stringify(context.previousResult),
  };
}

function parseVerificationContent(
  content: string | null,
  previousResult: AgentResult,
): { valid: boolean; status: 'approved' | 'revise'; response: string | null; issues: string[] } {
  const fallback = {
    valid: false,
    status: 'approved' as const,
    response: previousResult.response,
    issues: [] as string[],
  };

  if (!content) {
    return fallback;
  }

  const parsed = parseJsonObject(content);
  if (!parsed) {
    return fallback;
  }

  const status = parsed.status === 'revise' ? 'revise' : 'approved';
  const response =
    typeof parsed.response === 'string' && parsed.response.trim().length > 0
      ? parsed.response.trim()
      : previousResult.response;

  return {
    valid: true,
    status,
    response,
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.filter(
          (issue): issue is string => typeof issue === 'string' && issue.trim().length > 0,
        )
      : [],
  };
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}
