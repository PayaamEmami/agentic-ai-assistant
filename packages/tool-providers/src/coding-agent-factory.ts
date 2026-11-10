import { CodingAgentError, type CodingAgent } from './coding-agent.js';
import { CursorCodingAgent } from './cursor-coding-agent.js';

export function createCodingAgent(options: {
  provider: string;
  apiKey: string | undefined;
}): CodingAgent {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new CodingAgentError('Coding agent API key is not set');
  }

  switch (options.provider) {
    case 'cursor':
      return new CursorCodingAgent(apiKey);
    default:
      throw new Error(`Unsupported coding agent provider: ${options.provider}`);
  }
}
