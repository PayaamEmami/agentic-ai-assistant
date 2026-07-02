import type { ThinkingSegment } from './chat-stream-hooks.js';
import type { RetrievalCitation } from './retrieval-bridge.js';
import { toCitationContentBlocks } from './retrieval-helpers.js';

export interface AssistantMessageContentInput {
  assistantResponse: string;
  verificationStatus: 'approved' | 'revise' | null;
  verificationIssues: string[];
  thinkingSegments: ThinkingSegment[];
  toolResultBlocks: Array<Record<string, unknown>>;
  displayedCitations: RetrievalCitation[];
}

/**
 * Assembles the persisted assistant message content: the text block (with any
 * verification annotations), an optional thinking trace, and either tool-result
 * blocks or citation blocks.
 */
export function buildAssistantMessageContent(
  input: AssistantMessageContentInput,
): Array<Record<string, unknown>> {
  const assistantTextBlock: Record<string, unknown> = {
    type: 'text',
    text: input.assistantResponse,
  };
  if (input.verificationStatus) {
    assistantTextBlock['verificationStatus'] = input.verificationStatus;
  }
  if (input.verificationIssues.length > 0) {
    assistantTextBlock['verificationIssues'] = input.verificationIssues;
  }

  const content: Array<Record<string, unknown>> = [assistantTextBlock];

  if (input.thinkingSegments.length > 0) {
    content.push({ type: 'thinking', segments: input.thinkingSegments });
  }

  if (input.toolResultBlocks.length > 0) {
    content.push(...input.toolResultBlocks);
  } else {
    content.push(...toCitationContentBlocks(input.displayedCitations));
  }

  return content;
}
