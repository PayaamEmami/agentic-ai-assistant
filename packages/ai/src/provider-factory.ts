import type { OpenAIProviderModelConfig } from '@aaa/config';
import type { ChatProvider, EmbeddingProvider } from './model-provider.js';
import { OpenAIProvider } from './openai-provider.js';

export type ChatProviderName = 'openai';

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
): EmbeddingProvider {
  return new OpenAIProvider(apiKey, modelConfig);
}
