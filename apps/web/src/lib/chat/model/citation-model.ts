import type { ChatMessage, CitationItem } from './message-types';

export function extractCitations(messages: ChatMessage[]): CitationItem[] {
  const citations: CitationItem[] = [];

  for (const message of messages) {
    message.content.forEach((block, index) => {
      if (block.type !== 'citation') {
        return;
      }

      citations.push({
        id: `${message.id}-${index}`,
        title: block.title ?? block.sourceId ?? 'Source',
        excerpt: block.excerpt ?? '',
        uri: block.uri,
        sourceId: block.sourceId,
      });
    });
  }

  return citations;
}
