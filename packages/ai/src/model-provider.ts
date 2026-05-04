import type {
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  SpeechRequest,
  SpeechResponse,
  StreamDelta,
  TranscriptionRequest,
  TranscriptionResponse,
} from './types.js';

export interface ModelProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  streamComplete(request: CompletionRequest): AsyncIterable<StreamDelta>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResponse>;
  synthesizeSpeech(request: SpeechRequest): Promise<SpeechResponse>;
}
