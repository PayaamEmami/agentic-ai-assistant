import type { OpenAIProviderModelConfig } from '@aaa/config';
import type { ChatProvider, EmbeddingProvider } from './model-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { OpenAIRealtimeProvider } from './openai-realtime-provider.js';
import type { RealtimeProvider } from './realtime-provider.js';

export type ChatProviderName = 'openai';
export type EmbeddingProviderName = 'openai';
export type RealtimeProviderName = 'openai';

export function createChatProvider(
  apiKey: string,
  modelConfig: OpenAIProviderModelConfig,
  provider: ChatProviderName = 'openai',
): ChatProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIProvider(apiKey, modelConfig);
    default:
      throw new Error(`Unsupported LLM chat provider: ${provider as string}`);
  }
}

export function createEmbeddingProvider(
  apiKey: string,
  modelConfig: OpenAIProviderModelConfig,
  provider: EmbeddingProviderName = 'openai',
): EmbeddingProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIProvider(apiKey, modelConfig);
    default:
      throw new Error(`Unsupported LLM embedding provider: ${provider as string}`);
  }
}

export function createRealtimeProvider(
  apiKey: string,
  provider: RealtimeProviderName = 'openai',
): RealtimeProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIRealtimeProvider(apiKey);
    default:
      throw new Error(`Unsupported realtime provider: ${provider as string}`);
  }
}
