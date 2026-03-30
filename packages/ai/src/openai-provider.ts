import OpenAI from 'openai';
import {
  estimateOpenAiCost,
  getLogger,
  openAiDurationMs,
  openAiEstimatedCostUsd,
  openAiRequestCounter,
  openAiTokens,
  withSpan,
} from '@aaa/observability';
import type { ModelProvider } from './model-provider.js';
import type {
  ChatContentPart,
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  StreamDelta,
  ToolCall,
  ToolDefinition,
  TranscriptionRequest,
  TranscriptionResponse,
  SpeechRequest,
  SpeechResponse,
} from './types.js';

export class OpenAIProvider implements ModelProvider {
  private client: OpenAI;
  private defaultModel: string;
  private defaultEmbeddingModel: string;

  constructor(apiKey: string, model?: string, embeddingModel?: string) {
    this.client = new OpenAI({ apiKey });
    this.defaultModel = model ?? 'gpt-5-mini';
    this.defaultEmbeddingModel = embeddingModel ?? 'text-embedding-3-small';
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const logger = getLogger({ component: 'openai-provider', provider: 'openai' });
    const preparedTools = this.prepareTools(request.tools);
    const startedAt = Date.now();
    const model = request.model ?? this.defaultModel;
    try {
      const completion = await withSpan(
        'openai.chat.complete',
        {
          'ai.model': model,
          'aaa.ai.operation': 'chat_complete',
        },
        () =>
          this.client.chat.completions.create(
            {
              model,
              messages: this.mapMessages(request.messages),
              temperature: request.temperature,
              max_tokens: request.maxTokens,
              tools: preparedTools.tools,
            },
            request.signal ? { signal: request.signal } : undefined,
          ),
      );

      const choice = completion.choices[0];
      if (!choice) {
        throw new Error('OpenAI returned no completion choices');
      }

      const response = {
        messageId: completion.id,
        content: this.extractTextContent(choice.message.content),
        toolCalls: this.mapToolCalls(choice.message.tool_calls, preparedTools.aliasToOriginal),
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          totalTokens: completion.usage?.total_tokens ?? 0,
        },
      };

      logger.info(
        {
          event: 'openai.chat.completed',
          outcome: 'success',
          model,
          toolCount: request.tools?.length ?? 0,
          durationMs: Date.now() - startedAt,
          totalTokens: response.usage.totalTokens,
          estimatedCostUsd: estimateOpenAiCost({
            model,
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
          }),
        },
        'OpenAI chat completion finished',
      );
      openAiRequestCounter.inc({ operation: 'chat_complete', model, outcome: 'success' });
      openAiDurationMs.observe(
        { operation: 'chat_complete', model, outcome: 'success' },
        Date.now() - startedAt,
      );
      openAiTokens.inc(
        { operation: 'chat_complete', model, token_type: 'prompt' },
        response.usage.promptTokens,
      );
      openAiTokens.inc(
        { operation: 'chat_complete', model, token_type: 'completion' },
        response.usage.completionTokens,
      );
      openAiEstimatedCostUsd.inc(
        { operation: 'chat_complete', model },
        estimateOpenAiCost({
          model,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
        }),
      );

      return response;
    } catch (error) {
      openAiRequestCounter.inc({ operation: 'chat_complete', model, outcome: 'failure' });
      openAiDurationMs.observe(
        { operation: 'chat_complete', model, outcome: 'failure' },
        Date.now() - startedAt,
      );
      logger.error(
        {
          event: 'openai.chat.completed',
          outcome: 'failure',
          model,
          error,
        },
        'OpenAI chat completion failed',
      );
      throw error;
    }
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<StreamDelta> {
    const logger = getLogger({ component: 'openai-provider', provider: 'openai' });
    const preparedTools = this.prepareTools(request.tools);
    const startedAt = Date.now();
    const model = request.model ?? this.defaultModel;
    try {
      const stream = await withSpan(
        'openai.chat.stream',
        {
          'ai.model': model,
          'aaa.ai.operation': 'chat_stream',
        },
        () =>
          this.client.chat.completions.create(
            {
              model,
              messages: this.mapMessages(request.messages),
              temperature: request.temperature,
              max_tokens: request.maxTokens,
              tools: preparedTools.tools,
              stream: true,
            },
            request.signal ? { signal: request.signal } : undefined,
          ),
      );

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
              yield {
                type: 'tool_call',
                toolCall: {
                  ...current,
                  name: preparedTools.aliasToOriginal.get(current.name) ?? current.name,
                },
              };
            }
          }

          if (choice.finish_reason) {
            finishReason = this.mapFinishReason(choice.finish_reason);
          }
        }
      }

      logger.info(
        {
          event: 'openai.chat_stream.completed',
          outcome: 'success',
          model,
          durationMs: Date.now() - startedAt,
        },
        'OpenAI streaming completion finished',
      );
      openAiRequestCounter.inc({ operation: 'chat_stream', model, outcome: 'success' });
      openAiDurationMs.observe(
        { operation: 'chat_stream', model, outcome: 'success' },
        Date.now() - startedAt,
      );

      yield { type: 'done', finishReason: finishReason ?? 'stop' };
    } catch (error) {
      openAiRequestCounter.inc({ operation: 'chat_stream', model, outcome: 'failure' });
      openAiDurationMs.observe(
        { operation: 'chat_stream', model, outcome: 'failure' },
        Date.now() - startedAt,
      );
      logger.error(
        {
          event: 'openai.chat_stream.completed',
          outcome: 'failure',
          model,
          error,
        },
        'OpenAI streaming completion failed',
      );
      throw error;
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const logger = getLogger({ component: 'openai-provider', provider: 'openai' });
    const startedAt = Date.now();
    const model = request.model ?? this.defaultEmbeddingModel;
    try {
      const result = await withSpan(
        'openai.embedding.create',
        {
          'ai.model': model,
          'aaa.ai.operation': 'embedding',
        },
        () =>
          this.client.embeddings.create(
            {
              model,
              input: request.input,
            },
            request.signal ? { signal: request.signal } : undefined,
          ),
      );

      const response = {
        embeddings: result.data.map((entry) => entry.embedding),
        model: result.model,
        usage: {
          promptTokens: result.usage.prompt_tokens,
          totalTokens: result.usage.total_tokens,
        },
      };

      logger.info(
        {
          event: 'openai.embedding.completed',
          outcome: 'success',
          model,
          inputCount: request.input.length,
          durationMs: Date.now() - startedAt,
          totalTokens: response.usage.totalTokens,
          estimatedCostUsd: estimateOpenAiCost({
            model,
            inputTokens: response.usage.totalTokens,
          }),
        },
        'OpenAI embedding request finished',
      );
      openAiRequestCounter.inc({ operation: 'embedding', model, outcome: 'success' });
      openAiDurationMs.observe(
        { operation: 'embedding', model, outcome: 'success' },
        Date.now() - startedAt,
      );
      openAiTokens.inc(
        { operation: 'embedding', model, token_type: 'input' },
        response.usage.totalTokens,
      );
      openAiEstimatedCostUsd.inc(
        { operation: 'embedding', model },
        estimateOpenAiCost({
          model,
          inputTokens: response.usage.totalTokens,
        }),
      );

      return response;
    } catch (error) {
      openAiRequestCounter.inc({ operation: 'embedding', model, outcome: 'failure' });
      openAiDurationMs.observe(
        { operation: 'embedding', model, outcome: 'failure' },
        Date.now() - startedAt,
      );
      logger.error(
        {
          event: 'openai.embedding.completed',
          outcome: 'failure',
          model,
          error,
        },
        'OpenAI embedding request failed',
      );
      throw error;
    }
  }

  async transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    const logger = getLogger({ component: 'openai-provider', provider: 'openai' });
    const startedAt = Date.now();
    const model = request.model ?? 'gpt-4o-mini-transcribe';
    const file = new File([request.audio], request.fileName, {
      type: request.mimeType,
    });
    try {
      const transcription = await withSpan(
        'openai.audio.transcription',
        {
          'ai.model': model,
          'aaa.ai.operation': 'transcription',
        },
        () =>
          this.client.audio.transcriptions.create({
            file,
            model,
          }),
      );

      const response = {
        text: transcription.text.trim(),
      };

      logger.info(
        {
          event: 'openai.transcription.completed',
          outcome: 'success',
          model,
          durationMs: Date.now() - startedAt,
          transcriptLength: response.text.length,
        },
        'OpenAI transcription finished',
      );
      openAiRequestCounter.inc({ operation: 'transcription', model, outcome: 'success' });
      openAiDurationMs.observe(
        { operation: 'transcription', model, outcome: 'success' },
        Date.now() - startedAt,
      );

      return response;
    } catch (error) {
      openAiRequestCounter.inc({ operation: 'transcription', model, outcome: 'failure' });
      openAiDurationMs.observe(
        { operation: 'transcription', model, outcome: 'failure' },
        Date.now() - startedAt,
      );
      logger.error(
        {
          event: 'openai.transcription.completed',
          outcome: 'failure',
          model,
          error,
        },
        'OpenAI transcription failed',
      );
      throw error;
    }
  }

  async synthesizeSpeech(request: SpeechRequest): Promise<SpeechResponse> {
    const logger = getLogger({ component: 'openai-provider', provider: 'openai' });
    const format = request.format ?? 'mp3';
    const startedAt = Date.now();
    const model = request.model ?? 'gpt-4o-mini-tts';
    try {
      const response = await withSpan(
        'openai.audio.speech',
        {
          'ai.model': model,
          'aaa.ai.operation': 'speech',
        },
        () =>
          this.client.audio.speech.create({
            model,
            voice: request.voice ?? 'marin',
            input: request.input,
            response_format: format,
          }),
      );

      const result = {
        audio: Buffer.from(await response.arrayBuffer()),
        contentType: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      };

      logger.info(
        {
          event: 'openai.tts.completed',
          outcome: 'success',
          model,
          voice: request.voice ?? 'marin',
          durationMs: Date.now() - startedAt,
          audioBytes: result.audio.byteLength,
        },
        'OpenAI speech synthesis finished',
      );
      openAiRequestCounter.inc({ operation: 'speech', model, outcome: 'success' });
      openAiDurationMs.observe(
        { operation: 'speech', model, outcome: 'success' },
        Date.now() - startedAt,
      );

      return result;
    } catch (error) {
      openAiRequestCounter.inc({ operation: 'speech', model, outcome: 'failure' });
      openAiDurationMs.observe(
        { operation: 'speech', model, outcome: 'failure' },
        Date.now() - startedAt,
      );
      logger.error(
        {
          event: 'openai.tts.completed',
          outcome: 'failure',
          model,
          error,
        },
        'OpenAI speech synthesis failed',
      );
      throw error;
    }
  }

  private mapMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((message) => {
      switch (message.role) {
        case 'system':
          return {
            role: 'system',
            content:
              typeof message.content === 'string'
                ? message.content
                : this.extractTextFromParts(message.content),
            name: message.name,
          };
        case 'user':
          return {
            role: 'user',
            content: this.mapUserContent(message.content),
            name: message.name,
          };
        case 'assistant':
          return {
            role: 'assistant',
            content:
              typeof message.content === 'string'
                ? message.content
                : this.extractTextFromParts(message.content),
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
                : this.extractTextFromParts(message.content),
            tool_call_id: message.toolCallId,
          };
        default: {
          const neverRole: never = message.role;
          throw new Error(`Unsupported message role: ${String(neverRole)}`);
        }
      }
    });
  }

  private mapUserContent(
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

  private extractTextFromParts(parts: ChatContentPart[]): string {
    return parts
      .filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();
  }

  private prepareTools(tools?: ToolDefinition[]): {
    tools: OpenAI.ChatCompletionTool[] | undefined;
    aliasToOriginal: Map<string, string>;
  } {
    if (!tools || tools.length === 0) {
      return {
        tools: undefined,
        aliasToOriginal: new Map<string, string>(),
      };
    }

    const originalToAlias = new Map<string, string>();
    const aliasToOriginal = new Map<string, string>();
    const preparedTools = tools.map((tool) => {
      const alias = this.toToolAlias(tool.name, aliasToOriginal);
      originalToAlias.set(tool.name, alias);
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

  private toToolAlias(name: string, existingAliases: Map<string, string>): string {
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

  private mapToolCalls(
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

  private extractTextContent(content: unknown): string | null {
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
