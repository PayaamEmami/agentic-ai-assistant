import OpenAI from 'openai';
import type { OpenAIProviderModelConfig } from '@aaa/config';
import { estimateModelCost, withSpan } from '@aaa/observability';
import type { ModelProvider } from './model-provider.js';
import {
  buildChatCompletionCreateParams,
  extractTextContent,
  mapFinishReason,
  mapMessages,
  mapToolCalls,
  prepareTools,
  requiresResponsesForFunctionTools,
} from './openai-mappers.js';
import {
  applyResponsesStreamEvent,
  buildResponsesRequest,
  createResponsesTurnState,
} from './openai-responses.js';
import { OpenAiCallTelemetry } from './openai-telemetry.js';
import type {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  StreamDelta,
  ToolCall,
  TranscriptionRequest,
  TranscriptionResponse,
} from './types.js';

export type { OpenAIProviderModelConfig };

export class OpenAIProvider implements ModelProvider {
  private client: OpenAI;
  private readonly defaults: OpenAIProviderModelConfig;

  constructor(apiKey: string, defaults: OpenAIProviderModelConfig) {
    this.client = new OpenAI({ apiKey });
    this.defaults = defaults;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model ?? this.defaults.model;
    if (this.useResponsesApi(request, model)) {
      return this.completeWithResponses(request);
    }
    const telemetry = new OpenAiCallTelemetry('chat_complete', model);
    const preparedTools = prepareTools(request.tools);
    try {
      const completion = await withSpan(
        'openai.chat.complete',
        {
          'ai.model': model,
          'aaa.ai.operation': 'chat_complete',
        },
        () =>
          this.client.chat.completions.create(
            buildChatCompletionCreateParams({
              model,
              messages: mapMessages(request.messages),
              maxTokens: request.maxTokens,
              tools: preparedTools.tools,
            }),
            request.signal ? { signal: request.signal } : undefined,
          ),
      );

      const choice = completion.choices[0];
      if (!choice) {
        throw new Error('OpenAI returned no completion choices');
      }

      const response = {
        messageId: completion.id,
        content: extractTextContent(choice.message.content),
        toolCalls: mapToolCalls(choice.message.tool_calls, preparedTools.aliasToOriginal),
        finishReason: mapFinishReason(choice.finish_reason),
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          totalTokens: completion.usage?.total_tokens ?? 0,
        },
      };

      const estimatedCostUsd = estimateModelCost({
        model,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
      });
      telemetry.recordTokens('prompt', response.usage.promptTokens);
      telemetry.recordTokens('completion', response.usage.completionTokens);
      telemetry.recordCost(estimatedCostUsd);
      telemetry.success('openai.chat.completed', 'OpenAI chat completion finished', {
        toolCount: request.tools?.length ?? 0,
        totalTokens: response.usage.totalTokens,
        estimatedCostUsd,
      });

      return response;
    } catch (error) {
      telemetry.failure('openai.chat.completed', 'OpenAI chat completion failed', error);
      throw error;
    }
  }

  async *streamComplete(request: CompletionRequest): AsyncIterable<StreamDelta> {
    const model = request.model ?? this.defaults.model;
    if (this.useResponsesApi(request, model)) {
      yield* this.streamWithResponses(request);
      return;
    }
    const telemetry = new OpenAiCallTelemetry('chat_stream', model);
    const preparedTools = prepareTools(request.tools);
    try {
      const stream = await withSpan(
        'openai.chat.stream',
        {
          'ai.model': model,
          'aaa.ai.operation': 'chat_stream',
        },
        () =>
          this.client.chat.completions.create(
            buildChatCompletionCreateParams({
              model,
              messages: mapMessages(request.messages),
              maxTokens: request.maxTokens,
              tools: preparedTools.tools,
              stream: true,
            }),
            request.signal ? { signal: request.signal } : undefined,
          ),
      );

      const toolCallState = new Map<number, ToolCall>();
      let finishReason: CompletionResponse['finishReason'] | undefined;
      let usage: CompletionResponse['usage'] | undefined;

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }
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
            finishReason = mapFinishReason(choice.finish_reason);
          }
        }
      }

      if (usage) {
        telemetry.recordTokens('prompt', usage.promptTokens);
        telemetry.recordTokens('completion', usage.completionTokens);
        telemetry.recordCost(
          estimateModelCost({
            model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
          }),
        );
      }
      telemetry.success('openai.chat_stream.completed', 'OpenAI streaming completion finished', {
        totalTokens: usage?.totalTokens,
      });

      yield { type: 'done', finishReason: finishReason ?? 'stop', usage };
    } catch (error) {
      telemetry.failure(
        'openai.chat_stream.completed',
        'OpenAI streaming completion failed',
        error,
      );
      throw error;
    }
  }

  private useResponsesApi(request: CompletionRequest, model: string): boolean {
    return (
      Boolean(request.hostedWebSearch) ||
      requiresResponsesForFunctionTools(model, request.tools?.length ?? 0)
    );
  }

  private async completeWithResponses(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model ?? this.defaults.model;
    const telemetry = new OpenAiCallTelemetry('responses_complete', model);
    const { body, aliasToOriginal } = buildResponsesRequest({
      model,
      messages: request.messages,
      tools: request.tools,
      maxTokens: request.maxTokens,
      hostedWebSearch: request.hostedWebSearch === true,
    });

    try {
      const response = await withSpan(
        'openai.responses.complete',
        {
          'ai.model': model,
          'aaa.ai.operation': 'responses_complete',
        },
        () =>
          this.client.responses.create(
            body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming,
            request.signal ? { signal: request.signal } : undefined,
          ),
      );

      const state = createResponsesTurnState();
      applyResponsesStreamEvent(
        state,
        { type: 'response.completed', response },
        aliasToOriginal,
      );
      if (state.failedMessage) {
        throw new Error(state.failedMessage);
      }

      const usage = state.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const estimatedCostUsd = estimateModelCost({
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      });
      telemetry.recordTokens('prompt', usage.promptTokens);
      telemetry.recordTokens('completion', usage.completionTokens);
      telemetry.recordCost(estimatedCostUsd);
      telemetry.success('openai.responses.completed', 'OpenAI responses completion finished', {
        toolCount: request.tools?.length ?? 0,
        webSearchUsed: state.webSearchUsed,
        totalTokens: usage.totalTokens,
        estimatedCostUsd,
      });

      return {
        messageId: response.id,
        content: state.text.length > 0 ? state.text : null,
        toolCalls: state.toolCalls,
        finishReason: state.toolCalls.length > 0 ? 'tool_calls' : 'stop',
        usage,
        webSearchUsed: state.webSearchUsed || undefined,
      };
    } catch (error) {
      telemetry.failure('openai.responses.completed', 'OpenAI responses completion failed', error);
      throw error;
    }
  }

  private async *streamWithResponses(request: CompletionRequest): AsyncIterable<StreamDelta> {
    const model = request.model ?? this.defaults.model;
    const telemetry = new OpenAiCallTelemetry('responses_stream', model);
    const { body, aliasToOriginal } = buildResponsesRequest({
      model,
      messages: request.messages,
      tools: request.tools,
      maxTokens: request.maxTokens,
      stream: true,
      hostedWebSearch: request.hostedWebSearch === true,
    });

    try {
      const stream = await withSpan(
        'openai.responses.stream',
        {
          'ai.model': model,
          'aaa.ai.operation': 'responses_stream',
        },
        () =>
          this.client.responses.create(
            body as unknown as OpenAI.Responses.ResponseCreateParamsStreaming,
            request.signal ? { signal: request.signal } : undefined,
          ),
      );

      const state = createResponsesTurnState();
      for await (const event of stream) {
        for (const delta of applyResponsesStreamEvent(state, event, aliasToOriginal)) {
          yield delta;
        }
        if (state.failedMessage) {
          throw new Error(state.failedMessage);
        }
      }

      if (state.failedMessage) {
        throw new Error(state.failedMessage);
      }

      const usage = state.usage;
      if (usage) {
        telemetry.recordTokens('prompt', usage.promptTokens);
        telemetry.recordTokens('completion', usage.completionTokens);
        telemetry.recordCost(
          estimateModelCost({
            model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
          }),
        );
      }
      telemetry.success('openai.responses_stream.completed', 'OpenAI responses stream finished', {
        webSearchUsed: state.webSearchUsed,
        totalTokens: usage?.totalTokens,
      });

      yield {
        type: 'done',
        finishReason: state.toolCalls.length > 0 ? 'tool_calls' : 'stop',
        usage,
        webSearchUsed: state.webSearchUsed || undefined,
      };
    } catch (error) {
      telemetry.failure('openai.responses_stream.completed', 'OpenAI responses stream failed', error);
      throw error;
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? this.defaults.embeddingModel;
    const telemetry = new OpenAiCallTelemetry('embedding', model);
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

      const estimatedCostUsd = estimateModelCost({
        model,
        inputTokens: response.usage.totalTokens,
      });
      telemetry.recordTokens('input', response.usage.totalTokens);
      telemetry.recordCost(estimatedCostUsd);
      telemetry.success('openai.embedding.completed', 'OpenAI embedding request finished', {
        inputCount: request.input.length,
        totalTokens: response.usage.totalTokens,
        estimatedCostUsd,
      });

      return response;
    } catch (error) {
      telemetry.failure('openai.embedding.completed', 'OpenAI embedding request failed', error);
      throw error;
    }
  }

  async transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    const model = request.model ?? this.defaults.transcriptionModel;
    const telemetry = new OpenAiCallTelemetry('transcription', model);
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

      telemetry.success('openai.transcription.completed', 'OpenAI transcription finished', {
        transcriptLength: response.text.length,
      });

      return response;
    } catch (error) {
      telemetry.failure('openai.transcription.completed', 'OpenAI transcription failed', error);
      throw error;
    }
  }
}
