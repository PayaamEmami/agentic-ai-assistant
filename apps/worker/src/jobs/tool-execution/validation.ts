import { asNonEmptyString, asNumber, requireString } from '@aaa/shared';

// Re-exported so worker tool handlers keep a single validation import surface.
// `asString` here intentionally means "non-empty string" (the worker's original
// semantics).
export { asNumber, requireString };
export const asString = asNonEmptyString;

export function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'number' ? entry : Number.NaN))
    .filter((entry) => Number.isFinite(entry));
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function requireNumber(source: Record<string, unknown>, key: string): number {
  const value = asNumber(source[key]);
  if (typeof value !== 'number') {
    throw new Error(`Expected "${key}" to be a number`);
  }
  return value;
}

export function requireReviewEvent(value: unknown): 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' {
  if (value === 'APPROVE' || value === 'COMMENT' || value === 'REQUEST_CHANGES') {
    return value;
  }
  throw new Error('Expected "event" to be APPROVE, COMMENT, or REQUEST_CHANGES');
}
