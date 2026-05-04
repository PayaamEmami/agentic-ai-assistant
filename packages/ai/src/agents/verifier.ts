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
        usage: undefined,
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
        usage: context.previousResult.usage,
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
        usage: mergeUsage(context.previousResult.usage, completion.usage),
      };
    }

    const response = selectUserFacingVerifiedResponse(verified, context.previousResult);

    return {
      response,
      toolCalls: context.previousResult.toolCalls,
      delegateTo: null,
      requiresApproval: context.previousResult.requiresApproval,
      verification: {
        status: verified.status,
        issues: verified.issues,
      },
      usage: mergeUsage(context.previousResult.usage, completion.usage),
    };
  }
}

function mergeUsage(
  left?: AgentResult['usage'],
  right?: AgentResult['usage'],
): AgentResult['usage'] | undefined {
  if (!left && !right) {
    return undefined;
  }
  return {
    promptTokens: (left?.promptTokens ?? 0) + (right?.promptTokens ?? 0),
    completionTokens: (left?.completionTokens ?? 0) + (right?.completionTokens ?? 0),
    totalTokens: (left?.totalTokens ?? 0) + (right?.totalTokens ?? 0),
  };
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

function selectUserFacingVerifiedResponse(
  verified: { status: 'approved' | 'revise'; response: string | null },
  previousResult: AgentResult,
): string | null {
  if (verified.status !== 'revise') {
    return previousResult.response;
  }

  if (!verified.response || isLikelyInternalVerifierResponse(verified.response)) {
    return previousResult.response;
  }

  return verified.response;
}

function isLikelyInternalVerifierResponse(response: string): boolean {
  const normalized = response.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    /^(the\s+)?(prior|previous)\s+(agent\s+)?(message|output|response|result)\b/.test(normalized) ||
    /^the\s+assistant'?s\s+(prior|previous)\s+(message|output|response|result)\b/.test(normalized)
  ) {
    return true;
  }

  const markers = [
    'prior agent',
    'previous agent',
    'prior output',
    'previous output',
    'prior response',
    'previous response',
    'user-facing',
    'policy-aligned',
    'aligned with the user',
    'unsupported claims',
    'retrieved context',
    'tool use that did not happen',
    'live browsing/search/tool use',
  ];
  const markerCount = markers.reduce(
    (count, marker) => count + (normalized.includes(marker) ? 1 : 0),
    0,
  );

  return markerCount >= 2;
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
