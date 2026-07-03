import OpenAI from 'openai';
import { estimateOpenAiCost, withSpan } from '@aaa/observability';
import type { ModelProvider } from './model-provider.js';
import {
  extractTextContent,
  mapFinishReason,
  mapMessages,
  mapToolCalls,
  prepareTools,
} from './openai-mappers.js';
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
    const model = request.model ?? this.defaultModel;
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
            {
              model,
              messages: mapMessages(request.messages),
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
        content: extractTextContent(choice.message.content),
        toolCalls: mapToolCalls(choice.message.tool_calls, preparedTools.aliasToOriginal),
        finishReason: mapFinishReason(choice.finish_reason),
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
          totalTokens: completion.usage?.total_tokens ?? 0,
        },
      };

      const estimatedCostUsd = estimateOpenAiCost({
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
    const model = request.model ?? this.defaultModel;
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
            {
              model,
              messages: mapMessages(request.messages),
              temperature: request.temperature,
              max_tokens: request.maxTokens,
              tools: preparedTools.tools,
              stream: true,
              stream_options: { include_usage: true },
            },
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
          estimateOpenAiCost({
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

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const model = request.model ?? this.defaultEmbeddingModel;
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

      const estimatedCostUsd = estimateOpenAiCost({
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
    const model = request.model ?? 'gpt-4o-mini-transcribe';
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

  async synthesizeSpeech(request: SpeechRequest): Promise<SpeechResponse> {
    const format = request.format ?? 'mp3';
    const model = request.model ?? 'gpt-4o-mini-tts';
    const telemetry = new OpenAiCallTelemetry('speech', model);
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

      telemetry.success('openai.tts.completed', 'OpenAI speech synthesis finished', {
        voice: request.voice ?? 'marin',
        audioBytes: result.audio.byteLength,
      });

      return result;
    } catch (error) {
      telemetry.failure('openai.tts.completed', 'OpenAI speech synthesis failed', error);
      throw error;
    }
  }
}
