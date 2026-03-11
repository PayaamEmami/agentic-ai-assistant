import OpenAI from 'openai';
import type { ModelProvider } from './model-provider.js';
import type {
  CompletionRequest,
  CompletionResponse,
  StreamDelta,
  EmbeddingRequest,
  EmbeddingResponse,
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

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    // TODO: implement OpenAI chat completion call
    // Map CompletionRequest to OpenAI API format, call this.client.chat.completions.create()
    void this.client;
    void this.defaultModel;
    throw new Error('Not implemented');
  }

  async *streamComplete(_request: CompletionRequest): AsyncIterable<StreamDelta> {
    // TODO: implement OpenAI streaming completion
    // Use this.client.chat.completions.create({ stream: true })
    void this.client;
    void this.defaultModel;
    throw new Error('Not implemented');
  }

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResponse> {
    // TODO: implement OpenAI embedding call
    // Use this.client.embeddings.create()
    void this.client;
    void this.defaultEmbeddingModel;
    throw new Error('Not implemented');
  }
}
