import OpenAI from 'openai';
import type { ModelProvider } from './model-provider.js';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  StreamDelta,
  ToolCall,
  ToolDefinition,
} from './types.js';

export class OpenAIProvider implements ModelProvider {
  private client: OpenAI;
  private defaultModel: string;
  private defaultEmbeddingModel: string;

  constructor(apiKey: string, model?: string, embeddingModel?: string) {
    this.client = new OpenAI({ apiKey });
    this.defaultModel = model ?? 'gpt-4o';
    this.defaultEmbeddingModel = embeddingModel ?? 'text-embedding-3-small';
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const completion = await this.client.chat.completions.create({
      model: request.model ?? this.defaultModel,
      messages: this.mapMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      tools: this.mapTools(request.tools),
    });

    const choice = completion.choices[0];
    if (!choice) {
      throw new Error('OpenAI returned no completion choices');
    }

    return {
      messageId: completion.id,
      content: this.extractTextContent(choice.message.content),
      toolCalls: this.mapToolCalls(choice.message.tool_calls),
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
      },
    };
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<StreamDelta> {
    const stream = await this.client.chat.completions.create({
      model: request.model ?? this.defaultModel,
      messages: this.mapMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      tools: this.mapTools(request.tools),
      stream: true,
    });

    const toolCallState = new Map<number, ToolCall>();
    let finishReason: CompletionResponse['finishReason'] | undefined;

    for await (const chunk of stream) {
      for (const choice of chunk.choices) {
        if (choice.delta.content) {
          yield { type: 'text', text: choice.delta.content };
        }

        for (const toolCallDelta of choice.delta.tool_calls ?? []) {
          const current = toolCallState.get(toolCallDelta.index) ?? {
            id: toolCallDelta.id ?? `tool_call_${toolCallDelta.index}`,
            name: '',
            arguments: '',
          };

          if (toolCallDelta.id) {
            current.id = toolCallDelta.id;
          }
          if (toolCallDelta.function?.name) {
            current.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            current.arguments += toolCallDelta.function.arguments;
          }

          toolCallState.set(toolCallDelta.index, current);
          if (current.name) {
            yield { type: 'tool_call', toolCall: { ...current } };
          }
        }

        if (choice.finish_reason) {
          finishReason = this.mapFinishReason(choice.finish_reason);
        }
      }
    }

    yield { type: 'done', finishReason: finishReason ?? 'stop' };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const result = await this.client.embeddings.create({
      model: request.model ?? this.defaultEmbeddingModel,
      input: request.input,
    });

    return {
      embeddings: result.data.map((entry) => entry.embedding),
      model: result.model,
      usage: {
        promptTokens: result.usage.prompt_tokens,
        totalTokens: result.usage.total_tokens,
      },
    };
  }

  private mapMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((message) => {
      switch (message.role) {
        case 'system':
          return { role: 'system', content: message.content, name: message.name };
        case 'user':
          return { role: 'user', content: message.content, name: message.name };
        case 'assistant':
          return { role: 'assistant', content: message.content, name: message.name };
        case 'tool':
          if (!message.toolCallId) {
            throw new Error('Tool message must include toolCallId');
          }
          return {
            role: 'tool',
            content: message.content,
            tool_call_id: message.toolCallId,
          };
        default: {
          const neverRole: never = message.role;
          throw new Error(`Unsupported message role: ${String(neverRole)}`);
        }
      }
    });
  }

  private mapTools(tools?: ToolDefinition[]): OpenAI.ChatCompletionTool[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private mapToolCalls(toolCalls?: OpenAI.ChatCompletionMessageToolCall[]): ToolCall[] {
    if (!toolCalls || toolCalls.length === 0) return [];

    return toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    }));
  }

  private extractTextContent(content: unknown): string | null {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return null;

    const parts = content
      .map((part) => {
        if (typeof part !== 'object' || part === null) return '';

        if ('type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }

        if ('type' in part && part.type === 'refusal' && 'refusal' in part && typeof part.refusal === 'string') {
          return part.refusal;
        }

        return '';
      })
      .filter((part) => part.length > 0);

    return parts.length > 0 ? parts.join('\n') : null;
  }

  private mapFinishReason(
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
}
