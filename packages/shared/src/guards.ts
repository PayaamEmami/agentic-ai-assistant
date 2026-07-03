/**
 * Runtime type guards and coercion helpers shared across apps and packages.
 * Consolidates several near-identical local copies that had drifted in subtle
 * ways (e.g. whether empty strings are accepted).
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Returns the value when it is a string (including empty), otherwise undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Returns the value only when it is a non-empty (after trim) string. */
export function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Returns the value only when it is a finite number. */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Reads a required non-empty string field, throwing when missing or blank. */
export function requireString(source: Record<string, unknown>, key: string): string {
  const value = asNonEmptyString(source[key]);
  if (!value) {
    throw new Error(`Expected "${key}" to be a non-empty string`);
  }
  return value;
}

/** Detects browser/Node/OpenAI abort signals and the internal interrupt marker. */
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
