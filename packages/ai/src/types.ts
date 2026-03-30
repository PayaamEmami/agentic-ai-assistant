export interface ChatTextPart {
  type: 'text';
  text: string;
}

export interface ChatImagePart {
  type: 'image_url';
  imageUrl: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export type ChatContentPart = ChatTextPart | ChatImagePart;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[];
  name?: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
  signal?: AbortSignal;
}

export interface CompletionResponse {
  messageId: string;
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface StreamDelta {
  type: 'text' | 'tool_call' | 'done';
  text?: string;
  toolCall?: ToolCall;
  finishReason?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface EmbeddingRequest {
  input: string[];
  model?: string;
  signal?: AbortSignal;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  usage: { promptTokens: number; totalTokens: number };
}

export interface TranscriptionRequest {
  audio: Buffer;
  fileName: string;
  mimeType: string;
  model?: string;
}

export interface TranscriptionResponse {
  text: string;
}

export interface SpeechRequest {
  input: string;
  model?: string;
  voice?: string;
  format?: 'mp3' | 'wav';
}

export interface SpeechResponse {
  audio: Buffer;
  contentType: string;
}
