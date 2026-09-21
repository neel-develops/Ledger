/**
 * Postgres error codes, dug out from wherever the driver buried them.
 *
 * Drizzle wraps a failed query in its own error and hangs the driver's error
 * off `cause`, so a naive `error.code === '23505'` silently never matches.
 * That failure mode is quiet and expensive: a duplicate-key race would have
 * surfaced to the user as "something went wrong" instead of being recognised
 * and handled, so the code is resolved by walking the whole cause chain.
 */

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

export function pgErrorCode(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 8 && current; depth++) {
    if (typeof current === 'object') {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
      current = (current as { cause?: unknown }).cause;
    } else {
      return null;
    }
  }

  return null;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === PG_UNIQUE_VIOLATION;
}

export function isCheckViolation(error: unknown): boolean {
  return pgErrorCode(error) === PG_CHECK_VIOLATION;
}
