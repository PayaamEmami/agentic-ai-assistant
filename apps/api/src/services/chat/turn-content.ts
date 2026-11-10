import type { ThinkingSegment } from './stream-hooks.js';
import type { RetrievalCitation } from '../retrieval/bridge.js';
import { toCitationContentBlocks } from '../retrieval/helpers.js';

export interface AssistantMessageContentInput {
  assistantResponse: string;
  thinkingSegments: ThinkingSegment[];
  toolResultBlocks: Array<Record<string, unknown>>;
  displayedCitations: RetrievalCitation[];
}

/**
 * Assembles the persisted assistant message content: the text block, an
 * optional thinking trace, tool-result blocks, and citation chips.
 */
export function buildAssistantMessageContent(
  input: AssistantMessageContentInput,
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: input.assistantResponse,
    },
  ];

  if (input.thinkingSegments.length > 0) {
    content.push({ type: 'thinking', segments: input.thinkingSegments });
  }

  if (input.toolResultBlocks.length > 0) {
    content.push(...input.toolResultBlocks);
  }

  content.push(...toCitationContentBlocks(input.displayedCitations));

  return content;
}
