import type { ChatMessage, ToolCall, ToolDefinition } from '../types.js';
import type { SystemPromptContext } from '../prompts.js';
import type { AgentContext, AgentHistoryMessage, AgentResult, AgentToolContext } from './types.js';

const RESEARCH_HINTS = [
  '?',
  'what',
  'when',
  'where',
  'who',
  'why',
  'how',
  'tell me about',
  'explain',
  'show me',
  'search',
  'find',
  'look up',
  'sources',
  'source',
  'evidence',
  'according to',
  'what does',
  'summarize',
  'compare',
  'analyze',
];

export function toSystemPromptContext(context: AgentContext): SystemPromptContext {
  return {
    personalContext: context.personalContext,
    availableTools: context.availableTools,
    activeConnectors: context.activeConnectors,
  };
}

export function toChatMessages(history: AgentHistoryMessage[]): ChatMessage[] {
  return history.map((message) => {
    const role = normalizeRole(message.role);
    if (role === 'tool' && !message.toolCallId) {
      return {
        role: 'assistant',
        content: message.content,
        name: message.name,
      };
    }

    return {
      role,
      content: message.content,
      name: message.name,
      toolCallId: message.toolCallId,
    };
  });
}

export function toToolDefinitions(tools: Array<string | AgentToolContext>): ToolDefinition[] {
  return tools.map((tool) => {
    if (typeof tool === 'string') {
      return {
        name: tool,
        description: `Tool: ${tool}`,
        parameters: {},
      };
    }

    return {
      name: tool.name,
      description: tool.description ?? `Tool: ${tool.name}`,
      parameters: tool.parameters ?? {},
    };
  });
}

export function parseToolCalls(toolCalls: ToolCall[]): AgentResult['toolCalls'] {
  return toolCalls.map((toolCall) => ({
    name: toolCall.name,
    arguments: parseToolArguments(toolCall.arguments),
  }));
}

export function latestUserMessage(context: AgentContext): string {
  const history = [...context.messageHistory].reverse();
  const userMessage = history.find((message) => normalizeRole(message.role) === 'user');
  return userMessage ? extractTextContent(userMessage.content) : '';
}

export function shouldDelegateToResearch(context: AgentContext): boolean {
  if (context.retrievedContext.length === 0) {
    return false;
  }

  const latestMessage = latestUserMessage(context).toLowerCase();
  if (!latestMessage) {
    return false;
  }

  if (latestMessage.includes('?')) {
    return true;
  }

  return RESEARCH_HINTS.some((hint) => latestMessage.includes(hint));
}

const CODING_HINTS = [
  'code',
  'fix',
  'bug',
  'implement',
  'refactor',
  'open a pr',
  'create a pr',
  'pull request',
  'commit',
  'branch',
  'repository',
  'repo',
  'file',
  'test',
];

export function shouldDelegateToCoding(context: AgentContext): boolean {
  const latestMessage = latestUserMessage(context).toLowerCase();
  if (!latestMessage) {
    return false;
  }

  return CODING_HINTS.some((hint) => latestMessage.includes(hint));
}

export function requiresApprovalForCalls(
  toolCalls: AgentResult['toolCalls'],
  tools: Array<string | AgentToolContext>,
): boolean {
  if (toolCalls.length === 0) {
    return false;
  }

  const toolsByName = new Map<string, AgentToolContext>(
    tools
      .filter((tool): tool is AgentToolContext => typeof tool !== 'string')
      .map((tool) => [tool.name, tool]),
  );

  return toolCalls.some((toolCall) => toolsByName.get(toolCall.name)?.requiresApproval === true);
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  if (!argumentsJson.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return { value: parsed };
  } catch {
    return { rawArguments: argumentsJson };
  }
}

function normalizeRole(role: string): ChatMessage['role'] {
  switch (role) {
    case 'system':
    case 'assistant':
    case 'tool':
    case 'user':
      return role;
    default:
      return 'user';
  }
}

function extractTextContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}
