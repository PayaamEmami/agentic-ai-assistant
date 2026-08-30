const UNIQUE_VIOLATION = '23505';

/** True when Postgres rejected an insert/update as a unique constraint violation. */
export function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}
