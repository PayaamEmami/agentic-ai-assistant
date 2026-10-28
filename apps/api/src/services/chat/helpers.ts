export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Chat run interrupted');
  }
}

const DEFAULT_MAX_CONVERSATION_TITLE_CHARS = 80;

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return (
    Boolean(block) &&
    typeof block === 'object' &&
    !Array.isArray(block) &&
    (block as { type?: unknown }).type === 'text' &&
    typeof (block as { text?: unknown }).text === 'string'
  );
}

/** First text block on a stored message. Chat writes a single text block. */
export function readMessageText(content: unknown[]): string {
  for (const block of content) {
    if (isTextBlock(block)) {
      return block.text;
    }
  }
  return '';
}

/** Replaces text and keeps attachment and other non-text blocks in order. */
export function rewriteUserMessageContent(content: unknown[], text: string): unknown[] {
  const preserved = content.filter((block) => !isTextBlock(block));
  return [{ type: 'text', text }, ...preserved];
}

export function buildConversationTitle(
  content: string,
  maxChars = DEFAULT_MAX_CONVERSATION_TITLE_CHARS,
): string | undefined {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}
