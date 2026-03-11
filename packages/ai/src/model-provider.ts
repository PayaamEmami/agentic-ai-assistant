import type {
  CompletionRequest,
  CompletionResponse,
  StreamDelta,
  EmbeddingRequest,
  EmbeddingResponse,
} from './types.js';

export interface ModelProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  streamComplete(request: CompletionRequest): AsyncIterable<StreamDelta>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
