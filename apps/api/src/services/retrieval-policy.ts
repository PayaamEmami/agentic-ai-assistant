interface RetrievalDecisionMessage {
  role: string;
  content: unknown[];
}

export interface RetrievalDecision {
  shouldRetrieve: boolean;
  reason:
    | 'empty_message'
    | 'app_or_source_hint'
    | 'personal_document_hint'
    | 'explicit_document_query'
    | 'citation_follow_up'
    | 'small_talk'
    | 'no_retrieval_signal';
  hasRecentCitationContext: boolean;
}

const APP_OR_SOURCE_HINT =
  /\b(google drive|google docs|github|app|apps|synced|indexed|searchable|source|sources|citation|citations)\b/i;
const DOCUMENT_TARGET_HINT =
  /\b(resume|cv|cover letter|document|documents|doc|docs|file|files|note|notes|repo|repository|repositories|readme|attachment|attachments|pdf)\b/i;
const RETRIEVAL_ACTION_HINT =
  /\b(search|find|look up|summarize|compare|analyze|review|check|show me|according to|what does|can you see|where is|which)\b/i;
const POSSESSIVE_HINT = /\b(my|our|mine)\b/i;
const FILE_REFERENCE_HINT = /(^|[\s/])[\w.-]+\.(pdf|docx?|md|txt|tex)\b/i;
const FOLLOW_UP_HINT =
  /\b(what about|which one|the ai one|the dotnet one|that one|those ones|them|it|compare them|tell me more|expand on that|and the other one)\b/i;
const SMALL_TALK_PATTERNS = [
  /^\s*(hi|hello|hey|yo|hiya)\b[!,.()\s:;]*$/i,
  /^\s*(good morning|good afternoon|good evening)\b[!,.()\s:;]*$/i,
  /^\s*(thanks|thank you)\b[!,.()\s:;]*$/i,
  /\bhow are you\b/i,
  /\bhow'?s it going\b/i,
  /\bwhat'?s up\b/i,
  /\bnice to meet you\b/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function countMeaningfulTokens(text: string): number {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2).length;
}

function hasCitationBlock(message: RetrievalDecisionMessage): boolean {
  return message.content.some((block) => isRecord(block) && block.type === 'citation');
}

function hasRecentCitationContext(messages: RetrievalDecisionMessage[]): boolean {
  return messages
    .slice(-4)
    .some((message) => message.role === 'assistant' && hasCitationBlock(message));
}

function isLikelySmallTalk(text: string): boolean {
  return SMALL_TALK_PATTERNS.some((pattern) => pattern.test(text));
}

export function decideRetrieval(
  content: string,
  recentMessages: RetrievalDecisionMessage[],
): RetrievalDecision {
  const trimmed = content.trim();
  const recentCitationContext = hasRecentCitationContext(recentMessages);

  if (!trimmed) {
    return {
      shouldRetrieve: false,
      reason: 'empty_message',
      hasRecentCitationContext: recentCitationContext,
    };
  }

  if (APP_OR_SOURCE_HINT.test(trimmed)) {
    return {
      shouldRetrieve: true,
      reason: 'app_or_source_hint',
      hasRecentCitationContext: recentCitationContext,
    };
  }

  if (
    FILE_REFERENCE_HINT.test(trimmed) ||
    (DOCUMENT_TARGET_HINT.test(trimmed) && POSSESSIVE_HINT.test(trimmed))
  ) {
    return {
      shouldRetrieve: true,
      reason: 'personal_document_hint',
      hasRecentCitationContext: recentCitationContext,
    };
  }

  if (DOCUMENT_TARGET_HINT.test(trimmed) && RETRIEVAL_ACTION_HINT.test(trimmed)) {
    return {
      shouldRetrieve: true,
      reason: 'explicit_document_query',
      hasRecentCitationContext: recentCitationContext,
    };
  }

  if (
    recentCitationContext &&
    (FOLLOW_UP_HINT.test(trimmed) ||
      (trimmed.includes('?') && countMeaningfulTokens(trimmed) <= 16))
  ) {
    return {
      shouldRetrieve: true,
      reason: 'citation_follow_up',
      hasRecentCitationContext: recentCitationContext,
    };
  }

  if (isLikelySmallTalk(trimmed)) {
    return {
      shouldRetrieve: false,
      reason: 'small_talk',
      hasRecentCitationContext: recentCitationContext,
    };
  }

  return {
    shouldRetrieve: false,
    reason: 'no_retrieval_signal',
    hasRecentCitationContext: recentCitationContext,
  };
}
