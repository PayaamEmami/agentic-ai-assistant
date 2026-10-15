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
  /**
   * When true, this call uses the Responses API with OpenAI's hosted web
   * search tool. The model decides whether to search. Function tools on the
   * same request are still returned for the app to execute.
   */
  hostedWebSearch?: boolean;
  stream?: boolean;
  signal?: AbortSignal;
}

export interface CompletionResponse {
  messageId: string;
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** True when the hosted web search tool actually ran during this call. */
  webSearchUsed?: boolean;
}

export interface StreamDelta {
  type: 'text' | 'tool_call' | 'web_search' | 'done';
  text?: string;
  toolCall?: ToolCall;
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  webSearchUsed?: boolean;
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
