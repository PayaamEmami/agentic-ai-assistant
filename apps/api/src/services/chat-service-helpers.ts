const DEFAULT_MAX_CONVERSATION_TITLE_CHARS = 80;

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.name === 'APIUserAbortError' ||
      error.message === 'Chat run interrupted'
    );
  }

  return false;
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
