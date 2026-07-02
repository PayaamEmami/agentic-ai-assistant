const DEFAULT_MAX_CONVERSATION_TITLE_CHARS = 80;

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
