import type OpenAI from 'openai';
import type {
  ChatContentPart,
  ChatMessage,
  CompletionResponse,
  ToolCall,
  ToolDefinition,
} from './types.js';

export function extractTextFromParts(parts: ChatContentPart[]): string {
  return parts
    .filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export function mapUserContent(
  content: string | ChatContentPart[],
): string | OpenAI.ChatCompletionContentPart[] {
  if (typeof content === 'string') {
    return content;
  }

  return content.map<OpenAI.ChatCompletionContentPart>((part) => {
    if (part.type === 'text') {
      return {
        type: 'text',
        text: part.text,
      };
    }

    return {
      type: 'image_url',
      image_url: {
        url: part.imageUrl.url,
        detail: part.imageUrl.detail,
      },
    };
  });
}

export function mapMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    switch (message.role) {
      case 'system':
        return {
          role: 'system',
          content:
            typeof message.content === 'string'
              ? message.content
              : extractTextFromParts(message.content),
          name: message.name,
        };
      case 'user':
        return {
          role: 'user',
          content: mapUserContent(message.content),
          name: message.name,
        };
      case 'assistant':
        return {
          role: 'assistant',
          content:
            typeof message.content === 'string'
              ? message.content
              : extractTextFromParts(message.content),
          name: message.name,
        };
      case 'tool':
        if (!message.toolCallId) {
          throw new Error('Tool message must include toolCallId');
        }
        return {
          role: 'tool',
          content:
            typeof message.content === 'string'
              ? message.content
              : extractTextFromParts(message.content),
          tool_call_id: message.toolCallId,
        };
      default: {
        const neverRole: never = message.role;
        throw new Error(`Unsupported message role: ${String(neverRole)}`);
      }
    }
  });
}

function toToolAlias(name: string, existingAliases: Map<string, string>): string {
  const sanitizedBase = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const base = sanitizedBase.length > 0 ? sanitizedBase : 'tool';
  let alias = base;
  let suffix = 2;

  while (existingAliases.has(alias) && existingAliases.get(alias) !== name) {
    alias = `${base}_${suffix}`;
    suffix += 1;
  }

  return alias;
}

export interface PreparedTools {
  tools: OpenAI.ChatCompletionTool[] | undefined;
  aliasToOriginal: Map<string, string>;
}

export function prepareTools(tools?: ToolDefinition[]): PreparedTools {
  if (!tools || tools.length === 0) {
    return {
      tools: undefined,
      aliasToOriginal: new Map<string, string>(),
    };
  }

  const aliasToOriginal = new Map<string, string>();
  const preparedTools = tools.map((tool) => {
    const alias = toToolAlias(tool.name, aliasToOriginal);
    aliasToOriginal.set(alias, tool.name);

    return {
      type: 'function',
      function: {
        name: alias,
        description: tool.description,
        parameters: tool.parameters,
      },
    } satisfies OpenAI.ChatCompletionTool;
  });

  return {
    tools: preparedTools,
    aliasToOriginal,
  };
}

export function mapToolCalls(
  toolCalls?: OpenAI.ChatCompletionMessageToolCall[],
  aliasToOriginal?: Map<string, string>,
): ToolCall[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: aliasToOriginal?.get(toolCall.function.name) ?? toolCall.function.name,
    arguments: toolCall.function.arguments,
  }));
}

export function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;

  const parts = content
    .map((part) => {
      if (typeof part !== 'object' || part === null) return '';

      if (
        'type' in part &&
        part.type === 'text' &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return part.text;
      }

      if (
        'type' in part &&
        part.type === 'refusal' &&
        'refusal' in part &&
        typeof part.refusal === 'string'
      ) {
        return part.refusal;
      }

      return '';
    })
    .filter((part) => part.length > 0);

  return parts.length > 0 ? parts.join('\n') : null;
}

export function mapFinishReason(
  finishReason: string | null | undefined,
): CompletionResponse['finishReason'] {
  switch (finishReason) {
    case 'length':
    case 'tool_calls':
    case 'content_filter':
    case 'stop':
      return finishReason;
    case 'function_call':
      return 'tool_calls';
    default:
      return 'stop';
  }
}
