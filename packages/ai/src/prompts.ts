import type { ChatMessage } from './types.js';

export interface SystemPromptContext {
  personalContext?: string;
  availableTools?: string[];
  activeConnectors?: string[];
}

export function buildSystemPrompt(context: SystemPromptContext): string {
  // TODO: implement rich system prompt construction
  return `You are a helpful personal AI assistant.${context.personalContext ? `\n\nAbout the user: ${context.personalContext}` : ''}`;
}

export function buildRetrievalAugmentedMessages(
  messages: ChatMessage[],
  retrievedContext: string[],
): ChatMessage[] {
  if (retrievedContext.length === 0) return messages;

  const contextBlock = retrievedContext
    .map((c, i) => `[Source ${i + 1}]: ${c}`)
    .join('\n\n');

  const augmented: ChatMessage = {
    role: 'system',
    content: `Relevant context:\n\n${contextBlock}`,
  };

  const [system, ...rest] = messages;
  if (system && system.role === 'system') {
    return [system, augmented, ...rest];
  }
  return [augmented, ...messages];
}
