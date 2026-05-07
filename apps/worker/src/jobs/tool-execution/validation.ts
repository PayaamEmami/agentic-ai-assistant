export function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'number' ? entry : Number.NaN))
    .filter((entry) => Number.isFinite(entry));
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function requireString(source: Record<string, unknown>, key: string): string {
  const value = asString(source[key]);
  if (!value) {
    throw new Error(`Expected "${key}" to be a non-empty string`);
  }
  return value;
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
